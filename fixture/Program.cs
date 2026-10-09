namespace Fixture;

/// A disposable UI Automation acceptance target owned entirely by the test run.
/// It has no file system, network, or shell capability: its only effects are its
/// own window state, which makes an accidental action harmless and observable.
internal static class Program
{
    private static CheckBox _enabled = null!;
    private static readonly List<string> Log = new();

    [STAThread]
    private static void Main()
    {
        using var form = new Form
        {
            Text = "DSH Computer Use Fixture",
            Width = 420,
            Height = 260,
        };
        var status = new Label { Name = "statusLabel", Text = "idle", AutoSize = true, Left = 20, Top = 20 };
        var counter = new Label { Name = "counterLabel", Text = "count=0", AutoSize = true, Left = 20, Top = 50 };
        var button = new Button { Name = "applyButton", Text = "Apply", Left = 20, Top = 90, Width = 120 };
        var box = new CheckBox { Name = "toggleBox", Text = "Enabled", Left = 20, Top = 130, Checked = true };
        _enabled = box;
        button.Click += (_, _) =>
        {
            counter.Text = $"count={Log.Count + 1}";
            Log.Add("apply");
            status.Text = "applied";
        };
        box.CheckedChanged += (_, _) => status.Text = box.Checked ? "enabled" : "disabled";
        form.Controls.AddRange([status, counter, button, box]);
        Application.Run(form);
    }
}