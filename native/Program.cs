using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Windows.Automation;

namespace ComputerUse.Helper;

internal static class Program
{
    private static readonly Dictionary<string, Snapshot> Snapshots = new();
    private static readonly HashSet<string> AllowedTypes = new(StringComparer.Ordinal) { "Button", "CheckBox", "RadioButton", "MenuItem", "TabItem", "ListItem" };
    private static readonly HashSet<string> AllowedActions = new(StringComparer.Ordinal) { "Invoke", "Select", "Toggle" };
    private const int MaxElements = 100;
    private const int MaxAncestryDepth = 256;
    private static readonly TimeSpan ObservationLifetime = TimeSpan.FromSeconds(30);

    [STAThread]
    private static void Main()
    {
        using var input = Console.In;
        while (true)
        {
            Request request;
            try
            {
                var line = ReadLine(input);
                if (line is null) break;
                request = Protocol.Parse(line);
            }
            catch (Exception error) when (error is JsonException or InvalidDataException)
            {
                // A rejected line was already drained; the stream stays synchronized.
                Write(Protocol.Encode("", null, error.Message));
                continue;
            }
            try
            {
                var result = request.Method switch
                {
                    "hello" => new { version = 1, operations = new[] { "inspect", "observe", "invoke" } } as object,
                    "inspect" => Inspect(request.Parameters),
                    "observe" => Observe(request.Parameters),
                    "invoke" => Invoke(request.Parameters),
                    _ => throw new InvalidDataException("unknown operation")
                };
                Write(Protocol.Encode(request.Id, result, null));
            }
            catch (Exception error)
            {
                Snapshots.Clear();
                var message = error is InvalidDataException ? error.Message : "Windows automation operation failed";
                // Opt-in local diagnostics write to stderr, never into the protocol
                // response, so a caller cannot read internal exception detail.
                if (Environment.GetEnvironmentVariable("COMPUTER_USE_HELPER_DIAG") is { } flag and not ("" or "0"))
                    Console.Error.WriteLine($"{error.GetType().Name}: {error.Message}");
                try { Write(Protocol.Encode(request.Id, null, message)); }
                catch (InvalidDataException) { Write(Protocol.Encode(request.Id, null, "response exceeds protocol limits")); }
            }
        }
    }

    /// Reads one newline-terminated request. Buffering stops at the protocol limit and
    /// the remaining characters are discarded, so an over-long request is rejected
    /// without allocating a line of unbounded length.
    private static string? ReadLine(TextReader input)
    {
        var builder = new StringBuilder();
        var oversized = false;
        int value;
        while ((value = input.Read()) >= 0)
        {
            if (value != '\n')
            {
                if (builder.Length < Protocol.MaxLineLength) builder.Append((char)value);
                else oversized = true;
                continue;
            }
            if (oversized) throw new InvalidDataException("request exceeds protocol limits");
            return builder.ToString().TrimEnd('\r');
        }
        if (builder.Length == 0) return null;
        if (oversized) throw new InvalidDataException("request exceeds protocol limits");
        return builder.ToString();
    }

    private static void Diagnostics(string message)
    {
        if (Environment.GetEnvironmentVariable("COMPUTER_USE_HELPER_DIAG") is { } flag and not ("" or "0"))
            Console.Error.WriteLine("[diag] " + message);
    }

    private static void Write(string line)
    {
        Console.Out.WriteLine(line);
        Console.Out.Flush();
    }

    private static WindowIdentity Inspect(JsonElement input)
    {
        var hwnd = ReadHwnd(input);
        return GetWindow(hwnd);
    }

    private static object Observe(JsonElement input)
    {
        Snapshots.Clear();
        var hwnd = ReadHwnd(input);
        var identity = GetWindow(hwnd);
        var root = AutomationElement.FromHandle(hwnd);
        if (root is null) throw new InvalidDataException("UI Automation window unavailable");
        var elements = new List<object>();
        var targets = new List<ObservedElement>();
        var visited = 0;
        foreach (var element in Walk(root, identity.pid))
        {
            visited++;
            var fingerprint = Describe(element, out var reason);
            if (fingerprint is null) { Diagnostics("skip " + reason); continue; }
            if (fingerprint.Patterns.Count == 0) { Diagnostics("skip no-pattern " + fingerprint.Type + " '" + Bound(fingerprint.Name) + "'"); continue; }
            targets.Add(new ObservedElement(element, fingerprint));
            elements.Add(new
            {
                fingerprint.Type,
                name = Bound(fingerprint.Name),
                automationId = Bound(fingerprint.AutomationId),
                password = false,
                fingerprint.Patterns
            });
            if (targets.Count >= MaxElements) break;
            if (elements.Count > Protocol.MaxResponseLength / 256) throw new InvalidDataException("observation exceeds protocol limits");
        }
        var observationId = Guid.NewGuid().ToString("N");
        Diagnostics($"observed visited={visited} kept={targets.Count}");
        Snapshots[observationId] = new Snapshot(identity, targets, DateTime.UtcNow);
        return new { observationId, window = identity, elements };
    }

    /// Enumerates descendants breadth-first so a wide provider costs a bounded depth.
    private static IEnumerable<AutomationElement> Walk(AutomationElement root, int pid)
    {
        var walker = TreeWalker.ControlViewWalker;
        var queue = new Queue<(AutomationElement Element, int Depth)>();
        queue.Enqueue((root, 0));
        while (queue.Count > 0)
        {
            var (element, depth) = queue.Dequeue();
            AutomationElement child;
            try { child = walker.GetFirstChild(element); }
            catch (ElementNotAvailableException) { continue; }
            while (child is not null)
            {
                bool alive;
                try
                {
                    // A control owned by another process is not part of the observed window.
                    alive = child.Current.ProcessId == pid;
                    if (depth + 1 < MaxAncestryDepth) queue.Enqueue((child, depth + 1));
                }
                catch (ElementNotAvailableException) { alive = false; }
                if (alive) yield return child;
                try { child = walker.GetNextSibling(child); }
                catch (ElementNotAvailableException) { yield break; }
            }
        }
    }

    private static object Invoke(JsonElement input)
    {
        var id = ReadString(input, "observationId");
        var snapshot = Snapshots.GetValueOrDefault(id);
        Snapshots.Clear(); // A failed or ambiguous attempt still consumes the entire observation.
        if (snapshot is null || DateTime.UtcNow - snapshot.Created > ObservationLifetime) throw new InvalidDataException("observation expired");
        var index = ReadInt(input, "index");
        var action = ReadString(input, "action");
        if (!AllowedActions.Contains(action) || index < 0 || index >= snapshot.Elements.Count) throw new InvalidDataException("unsupported target or action");
        var actual = GetWindow((nint)snapshot.Window.hwnd);
        if (actual != snapshot.Window) throw new InvalidDataException("window changed");
        var entry = snapshot.Elements[index];
        if (!entry.Element.Current.IsEnabled || entry.Element.Current.IsOffscreen) throw new InvalidDataException("target is unavailable");
        var current = Describe(entry.Element, out _);
        if (current is null || !current.Matches(entry.Fingerprint)) throw new InvalidDataException("target changed since observation");
        if (!DescendsFrom(entry.Element, (nint)snapshot.Window.hwnd)) throw new InvalidDataException("target no longer belongs to the observed window");
        if (action == "Invoke" && entry.Element.TryGetCurrentPattern(InvokePattern.Pattern, out var invoke)) ((InvokePattern)invoke).Invoke();
        else if (action == "Select" && entry.Element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var select)) ((SelectionItemPattern)select).Select();
        else if (action == "Toggle" && entry.Element.TryGetCurrentPattern(TogglePattern.Pattern, out var toggle)) ((TogglePattern)toggle).Toggle();
        else throw new InvalidDataException("target no longer supports action");
        return new { delivered = true }; // Delivery does not prove outcome. Observe again.
    }

    /// Confirms the element still sits under the approved window, so a reparented or
    /// moved control cannot receive an action approved for a different target.
    private static bool DescendsFrom(AutomationElement element, nint hwnd)
    {
        var root = AutomationElement.FromHandle(hwnd);
        if (root is null || !root.Current.NativeWindowHandle.Equals(hwnd)) return false;
        var walker = TreeWalker.ControlViewWalker;
        var current = element;
        for (var depth = 0; depth < MaxAncestryDepth; depth++)
        {
            AutomationElement parent;
            try { parent = walker.GetParent(current); }
            catch (ElementNotAvailableException) { return false; }
            if (parent is null) return false;
            try
            {
                if (parent.Current.NativeWindowHandle.Equals(hwnd)) return true;
            }
            catch (ElementNotAvailableException) { return false; }
            current = parent;
        }
        return false;
    }

    private static Fingerprint? Describe(AutomationElement element, out string reason)
    {
        reason = "";
        try
        {
            var current = element.Current;
            var type = current.ControlType.ProgrammaticName.Replace("ControlType.", "", StringComparison.Ordinal);
            if (!AllowedTypes.Contains(type)) { reason = $"type={type}"; return null; }
            if (current.IsPassword) { reason = "password"; return null; }
            if (!current.IsEnabled) { reason = "disabled"; return null; }
            var patterns = new List<string>();
            if (element.TryGetCurrentPattern(InvokePattern.Pattern, out _)) patterns.Add("Invoke");
            if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out _)) patterns.Add("Select");
            if (element.TryGetCurrentPattern(TogglePattern.Pattern, out _)) patterns.Add("Toggle");
            return new Fingerprint(type, current.Name ?? "", current.AutomationId ?? "", patterns);
        }
        catch (ElementNotAvailableException) { reason = "unavailable"; return null; }
    }

    private static string Bound(string value) => value.Length > 256 ? value[..256] : value;

    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const long UnixTimeTicksAtEpoch = 621_355_968_000_000_000L;

    private static WindowIdentity GetWindow(nint hwnd)
    {
        if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || GetAncestor(hwnd, 2) != hwnd) throw new InvalidDataException("window unavailable");
        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == 0) throw new InvalidDataException("window process unavailable");
        // Query the process with limited information rights: packaged and elevated
        // applications reject PROCESS_QUERY_INFORMATION, which .NET MainModule and
        // StartTime both require. A relative image name would weaken the allowlist,
        // so only a readable full path produces an acceptable identity.
        var handle = OpenProcess(ProcessQueryLimitedInformation, false, pid);
        string executable;
        DateTime started;
        try
        {
            var buffer = new char[32768];
            var size = (nint)buffer.Length;
            if (!QueryFullProcessImageName(handle, 0, buffer, ref size)) throw new InvalidDataException("process identity unavailable");
            executable = Path.GetFileName(new string(buffer, 0, size.ToInt32()));
            if (!GetProcessTimes(handle, out var created, out _, out _, out _)) throw new InvalidDataException("process identity unavailable");
            started = DateTime.UnixEpoch.AddTicks(created - UnixTimeTicksAtEpoch);
        }
        finally { CloseHandle(handle); }
        var titleLength = GetWindowTextLength(hwnd);
        if (titleLength <= 0 || titleLength > 512) throw new InvalidDataException("window title unavailable");
        var title = new StringBuilder(titleLength + 1);
        GetWindowText(hwnd, title, title.Capacity);
        return new WindowIdentity((long)hwnd, checked((int)pid), started, executable, title.ToString());
    }

    private static nint ReadHwnd(JsonElement input) => checked((nint)ReadLong(input, "hwnd"));
    private static long ReadLong(JsonElement input, string key)
    {
        if (!input.TryGetProperty(key, out var value) || !value.TryGetInt64(out var result) || result <= 0) throw new InvalidDataException($"invalid {key}");
        return result;
    }
    private static int ReadInt(JsonElement input, string key)
    {
        if (!input.TryGetProperty(key, out var value) || !value.TryGetInt32(out var result)) throw new InvalidDataException($"invalid {key}");
        return result;
    }
    private static string ReadString(JsonElement input, string key)
    {
        if (!input.TryGetProperty(key, out var value) || value.ValueKind != JsonValueKind.String || string.IsNullOrEmpty(value.GetString())) throw new InvalidDataException($"invalid {key}");
        return value.GetString()!;
    }

    private sealed record Snapshot(WindowIdentity Window, List<ObservedElement> Elements, DateTime Created);
    private sealed record ObservedElement(AutomationElement Element, Fingerprint Fingerprint);
    private sealed record Fingerprint(string Type, string Name, string AutomationId, List<string> Patterns)
    {
        /// Compares every field that identifies the approved control.
        internal bool Matches(Fingerprint other) =>
            Type == other.Type && Name == other.Name && AutomationId == other.AutomationId && Patterns.SequenceEqual(other.Patterns);
    }
    private sealed record WindowIdentity(long hwnd, int pid, DateTime processStarted, string app, string title);

    [DllImport("user32.dll")] private static extern bool IsWindow(nint hWnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hWnd);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint hWnd, uint gaFlags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hWnd, out uint processId);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern nint OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern bool QueryFullProcessImageName(nint process, uint flags, char[] buffer, ref nint size);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool GetProcessTimes(nint process, out long creation, out long exit, out long kernel, out long user);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(nint handle);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(nint hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(nint hWnd);
}