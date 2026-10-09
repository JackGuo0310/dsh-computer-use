using System.IO;
using System.Text;
using System.Text.Json;

namespace ComputerUse.Helper;

internal static class Protocol
{
    internal const int MaxLineLength = 16_384;
    internal const int MaxResponseLength = 128_000;

    internal static Request Parse(string line)
    {
        if (line.Length == 0 || line.Length > MaxLineLength) throw new InvalidDataException("request exceeds protocol limits");
        using var document = JsonDocument.Parse(line);
        var root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("id", out var id) ||
            id.ValueKind != JsonValueKind.String || string.IsNullOrWhiteSpace(id.GetString()) || id.GetString()!.Length > 64 ||
            !root.TryGetProperty("method", out var method) || method.ValueKind != JsonValueKind.String)
            throw new InvalidDataException("invalid request envelope");
        var operation = method.GetString()!;
        if (operation is not ("hello" or "inspect" or "observe" or "invoke")) throw new InvalidDataException("unknown operation");
        if (!root.TryGetProperty("params", out var parameters) || parameters.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("invalid parameters");
        return new Request(id.GetString()!, operation, parameters.Clone());
    }

    internal static string Encode(string id, object? result, string? error)
    {
        var serialized = JsonSerializer.Serialize(new { id, result, error });
        if (serialized.Length > MaxResponseLength) throw new InvalidDataException("response exceeds protocol limits");
        return serialized;
    }

    /// Reads one newline-terminated request. Buffering stops at the protocol limit
    /// and the remaining characters are discarded, so an over-long request is
    /// rejected without allocating a line of unbounded length. Returns null at end
    /// of input, which is how the caller learns the peer closed the stream.
    internal static string? ReadLine(TextReader input)
    {
        var builder = new StringBuilder();
        var oversized = false;
        int value;
        while ((value = input.Read()) >= 0)
        {
            if (value != '\n')
            {
                if (builder.Length < MaxLineLength) builder.Append((char)value);
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
}

internal sealed record Request(string Id, string Method, JsonElement Parameters);
