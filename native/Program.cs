using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows.Automation;

namespace ComputerUse.Helper;

internal static class Program
{
    private static readonly Dictionary<string, Snapshot> Snapshots = new();
    private static readonly HashSet<string> AllowedTypes = new(StringComparer.Ordinal) { "Button", "CheckBox", "RadioButton", "MenuItem", "TabItem", "ListItem" };
    private static readonly HashSet<string> AllowedActions = new(StringComparer.Ordinal) { "Invoke", "Select", "Toggle" };

    [STAThread]
    private static void Main()
    {
        while (Console.ReadLine() is { } line)
        {
            Request request;
            try { request = Protocol.Parse(line); }
            catch (Exception error) when (error is JsonException or InvalidDataException)
            {
                Console.WriteLine(Protocol.Encode("", null, error.Message));
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
                Console.WriteLine(Protocol.Encode(request.Id, result, null));
            }
            catch (Exception error)
            {
                Snapshots.Clear();
                Console.WriteLine(Protocol.Encode(request.Id, null, error is InvalidDataException ? error.Message : "Windows automation operation failed"));
            }
        }
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
        var children = root.FindAll(TreeScope.Descendants, Condition.TrueCondition);
        var elements = new List<object>();
        var handles = new List<AutomationElement>();
        for (var i = 0; i < children.Count && handles.Count < 100; i++)
        {
            try
            {
                var element = children[i];
                var type = element.Current.ControlType.ProgrammaticName.Replace("ControlType.", "", StringComparison.Ordinal);
                if (!AllowedTypes.Contains(type) || element.Current.IsPassword || !element.Current.IsEnabled) continue;
                var patterns = new List<string>();
                if (element.TryGetCurrentPattern(InvokePattern.Pattern, out _)) patterns.Add("Invoke");
                if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out _)) patterns.Add("Select");
                if (element.TryGetCurrentPattern(TogglePattern.Pattern, out _)) patterns.Add("Toggle");
                if (patterns.Count == 0) continue;
                handles.Add(element);
                elements.Add(new { type, name = element.Current.Name, automationId = element.Current.AutomationId, password = false, patterns });
            }
            catch (ElementNotAvailableException) { }
        }
        var observationId = Guid.NewGuid().ToString("N");
        Snapshots[observationId] = new Snapshot(identity, handles, DateTime.UtcNow);
        return new { observationId, window = identity, elements };
    }

    private static object Invoke(JsonElement input)
    {
        var id = ReadString(input, "observationId");
        var snapshot = Snapshots.GetValueOrDefault(id);
        Snapshots.Clear(); // A failed or ambiguous attempt still consumes the entire observation.
        if (snapshot is null || DateTime.UtcNow - snapshot.Created > TimeSpan.FromSeconds(30)) throw new InvalidDataException("observation expired");
        var index = ReadInt(input, "index");
        var action = ReadString(input, "action");
        if (!AllowedActions.Contains(action) || index < 0 || index >= snapshot.Elements.Count) throw new InvalidDataException("unsupported target or action");
        var actual = GetWindow((nint)snapshot.Window.hwnd);
        if (actual != snapshot.Window) throw new InvalidDataException("window changed");
        var target = snapshot.Elements[index];
        var type = target.Current.ControlType.ProgrammaticName.Replace("ControlType.", "", StringComparison.Ordinal);
        if (!AllowedTypes.Contains(type) || target.Current.IsPassword || !target.Current.IsEnabled) throw new InvalidDataException("target is unavailable");
        if (target.Current.ProcessId != snapshot.Window.pid) throw new InvalidDataException("target process changed");
        if (action == "Invoke" && target.TryGetCurrentPattern(InvokePattern.Pattern, out var invoke)) ((InvokePattern)invoke).Invoke();
        else if (action == "Select" && target.TryGetCurrentPattern(SelectionItemPattern.Pattern, out var select)) ((SelectionItemPattern)select).Select();
        else if (action == "Toggle" && target.TryGetCurrentPattern(TogglePattern.Pattern, out var toggle)) ((TogglePattern)toggle).Toggle();
        else throw new InvalidDataException("target no longer supports action");
        return new { delivered = true }; // Delivery does not prove outcome. Observe again.
    }

    private static WindowIdentity GetWindow(nint hwnd)
    {
        if (!IsWindow(hwnd) || !IsWindowVisible(hwnd) || GetAncestor(hwnd, 2) != hwnd) throw new InvalidDataException("window unavailable");
        GetWindowThreadProcessId(hwnd, out var pid);
        if (pid == 0) throw new InvalidDataException("window process unavailable");
        var process = Process.GetProcessById(checked((int)pid));
        var executable = Path.GetFileName(process.MainModule?.FileName) ?? throw new InvalidDataException("executable unavailable");
        var titleLength = GetWindowTextLength(hwnd);
        if (titleLength <= 0 || titleLength > 512) throw new InvalidDataException("window title unavailable");
        var title = new System.Text.StringBuilder(titleLength + 1);
        GetWindowText(hwnd, title, title.Capacity);
        return new WindowIdentity((long)hwnd, checked((int)pid), executable, title.ToString());
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

    private sealed record Snapshot(WindowIdentity Window, List<AutomationElement> Elements, DateTime Created);
    private sealed record WindowIdentity(long hwnd, int pid, string app, string title);

    [DllImport("user32.dll")] private static extern bool IsWindow(nint hWnd);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(nint hWnd);
    [DllImport("user32.dll")] private static extern nint GetAncestor(nint hWnd, uint gaFlags);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hWnd, out uint processId);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(nint hWnd, System.Text.StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowTextLength(nint hWnd);
}
