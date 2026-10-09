using System.IO;
using System.Text.Json;
using Xunit;

namespace ComputerUse.Helper.Tests;

/// Protocol-level tests. These never construct a window, a process or an
/// AutomationElement, so the suite is safe to run on a live desktop.
public class ProtocolTests
{
    [Fact]
    public void ParseAcceptsAWellFormedRequest()
    {
        var request = Protocol.Parse("""{"id":"abc","method":"hello","params":{}}""");
        Assert.Equal("abc", request.Id);
        Assert.Equal("hello", request.Method);
        Assert.Equal(JsonValueKind.Object, request.Parameters.ValueKind);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("[]")]
    [InlineData("""{"method":"hello","params":{}}""")]
    [InlineData("""{"id":"","method":"hello","params":{}}""")]
    [InlineData("""{"id":"   ","method":"hello","params":{}}""")]
    [InlineData("""{"id":1,"method":"hello","params":{}}""")]
    [InlineData("""{"id":"a","params":{}}""")]
    [InlineData("""{"id":"a","method":5,"params":{}}""")]
    [InlineData("""{"id":"a","method":"hello"}""")]
    [InlineData("""{"id":"a","method":"hello","params":[]}""")]
    [InlineData("""{"id":"a","method":"hello","params":null}""")]
    public void ParseRejectsAMalformedEnvelope(string line)
    {
        Assert.ThrowsAny<Exception>(() => Protocol.Parse(line));
    }

    [Theory]
    [InlineData("exec")]
    [InlineData("shell")]
    [InlineData("type")]
    [InlineData("HELLO")]
    [InlineData("hello ")]
    public void ParseRejectsAnyOperationOutsideTheFixedSet(string method)
    {
        // The operation set is fixed: no operation may reach window or input code
        // unless it is one the protocol declares.
        var line = "{\"id\":\"a\",\"method\":\"" + method + "\",\"params\":{}}";
        Assert.Throws<InvalidDataException>(() => Protocol.Parse(line));
    }

    [Fact]
    public void ParseRejectsAnOverlongLine()
    {
        var padding = new string('A', Protocol.MaxLineLength);
        var line = "{\"id\":\"a\",\"method\":\"hello\",\"params\":{\"pad\":\"" + padding + "\"}}";
        Assert.True(line.Length > Protocol.MaxLineLength);
        Assert.Throws<InvalidDataException>(() => Protocol.Parse(line));
    }

    [Fact]
    public void ParseRejectsAnOverlongId()
    {
        var id = new string('x', 65);
        var line = "{\"id\":\"" + id + "\",\"method\":\"hello\",\"params\":{}}";
        Assert.Throws<InvalidDataException>(() => Protocol.Parse(line));
    }

    [Fact]
    public void ParseDetachesParametersFromTheParsedDocument()
    {
        // Parameters must survive the JsonDocument being disposed, or every later
        // read of them would observe freed memory.
        Request request;
        using (var scope = new MemoryStream())
        {
            request = Protocol.Parse("""{"id":"a","method":"observe","params":{"hwnd":4242}}""");
        }
        Assert.Equal(4242, request.Parameters.GetProperty("hwnd").GetInt32());
    }

    [Fact]
    public void EncodeProducesASingleLineEnvelope()
    {
        var encoded = Protocol.Encode("abc", new { delivered = true }, null);
        Assert.DoesNotContain('\n', encoded);
        using var document = JsonDocument.Parse(encoded);
        Assert.Equal("abc", document.RootElement.GetProperty("id").GetString());
        Assert.True(document.RootElement.GetProperty("result").GetProperty("delivered").GetBoolean());
        Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("error").ValueKind);
    }

    [Fact]
    public void EncodeRefusesAnOversizedResponse()
    {
        var oversized = new string('x', Protocol.MaxResponseLength);
        Assert.Throws<InvalidDataException>(() => Protocol.Encode("a", new { pad = oversized }, null));
    }

    [Fact]
    public void EncodeCarriesAnErrorWithANullResult()
    {
        var encoded = Protocol.Encode("a", null, "window unavailable");
        using var document = JsonDocument.Parse(encoded);
        Assert.Equal(JsonValueKind.Null, document.RootElement.GetProperty("result").ValueKind);
        Assert.Equal("window unavailable", document.RootElement.GetProperty("error").GetString());
    }

    [Fact]
    public void ReadLineReturnsNullWhenTheStreamEnds()
    {
        Assert.Null(Protocol.ReadLine(new StringReader("")));
    }

    [Fact]
    public void ReadLineSplitsOnNewlineAndTrimsCarriageReturn()
    {
        var input = new StringReader("first\r\nsecond\n");
        Assert.Equal("first", Protocol.ReadLine(input));
        Assert.Equal("second", Protocol.ReadLine(input));
        Assert.Null(Protocol.ReadLine(input));
    }

    [Fact]
    public void ReadLineRejectsAnOverlongRequestAndStaysSynchronized()
    {
        // The rejected line must be consumed through its newline, otherwise the
        // next read would return the tail of a request already refused.
        var oversized = new string('A', Protocol.MaxLineLength + 500) + "\n" + """{"id":"a","method":"hello","params":{}}""" + "\n";
        var input = new StringReader(oversized);
        Assert.Throws<InvalidDataException>(() => Protocol.ReadLine(input));
        Assert.Equal("""{"id":"a","method":"hello","params":{}}""", Protocol.ReadLine(input));
    }

    [Fact]
    public void ReadLineReturnsAFinalLineWithoutATrailingNewline()
    {
        Assert.Equal("tail", Protocol.ReadLine(new StringReader("tail")));
    }
}