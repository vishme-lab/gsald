// StartDashboard.exe - one-click Windows launcher for the Cyber Security Employee Dashboard.
//
// 1. Finds Python 3.10+ on this PC. If there is none, offers to install Python 3.13
//    with winget (Microsoft's package manager, which verifies the installer's hash).
// 2. Runs launcher.py from the same folder, which creates the virtual environment,
//    installs the pinned packages and starts the server.
//
// Rebuild with windows\build_exe.bat (uses the C# compiler built into Windows).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Text;

[assembly: AssemblyTitle("Cyber Security Employee Dashboard launcher")]
[assembly: AssemblyProduct("Cyber Security Employee Dashboard")]
[assembly: AssemblyDescription("Installs the prerequisites and starts the dashboard server")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

static class StartDashboard
{
    const string WingetPythonId = "Python.Python.3.13";
    const string VersionCheck = "import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)";

    static int Main(string[] args)
    {
        Console.Title = "Cyber Security Employee Dashboard";
        // Ctrl+C reaches the server too; keep this process alive until the server has shut down.
        Console.CancelKeyPress += (sender, e) => { e.Cancel = true; };

        string root = AppDomain.CurrentDomain.BaseDirectory;
        string launcher = Path.Combine(root, "launcher.py");
        if (!File.Exists(launcher))
            return Fail("launcher.py was not found next to StartDashboard.exe. Keep the exe inside the dashboard folder.");

        string[] python = FindPython();
        if (python == null)
        {
            Console.WriteLine("Python 3.10 or newer is required but was not found on this PC.");
            if (!InstallPython())
                return Fail("Python could not be installed automatically. Install it from https://www.python.org/downloads/ "
                          + "(tick \"Add python.exe to PATH\"), then run StartDashboard.exe again.");
            python = FindPython();
            if (python == null)
                return Fail("Python was installed but is not visible yet. Close this window and run StartDashboard.exe again.");
        }
        Console.WriteLine("[setup] Using Python: " + python[0]);

        var arguments = new List<string>();
        for (int i = 1; i < python.Length; i++) arguments.Add(python[i]);
        arguments.Add(launcher);
        arguments.Add("--no-pause");
        arguments.AddRange(args);

        int code = Run(python[0], arguments, root, false);
        if (code != 0) Pause();
        return code;
    }

    // ------------------------------------------------------------ Python lookup

    static string[] FindPython()
    {
        var candidates = new List<string[]>();
        string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string windir = Environment.GetEnvironmentVariable("WINDIR") ?? @"C:\Windows";

        foreach (string py in new[] { OnPath("py.exe"), Path.Combine(windir, "py.exe"),
                                      Path.Combine(local, @"Programs\Python\Launcher\py.exe") })
            if (py != null && File.Exists(py)) candidates.Add(new[] { py, "-3" });

        string onPath = OnPath("python.exe");
        if (onPath != null) candidates.Add(new[] { onPath });

        foreach (string baseDir in new[] { Path.Combine(local, @"Programs\Python"),
                                           Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles) })
        {
            if (!Directory.Exists(baseDir)) continue;
            string[] dirs = Directory.GetDirectories(baseDir, "Python3*");
            Array.Sort(dirs);
            Array.Reverse(dirs);  // newest first
            foreach (string d in dirs)
            {
                string exe = Path.Combine(d, "python.exe");
                if (File.Exists(exe)) candidates.Add(new[] { exe });
            }
        }

        foreach (string[] c in candidates)
        {
            var testArgs = new List<string>();
            for (int i = 1; i < c.Length; i++) testArgs.Add(c[i]);
            testArgs.Add("-c");
            testArgs.Add(VersionCheck);
            if (Run(c[0], testArgs, null, true) == 0) return c;
        }
        return null;
    }

    static string OnPath(string name)
    {
        string path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (string dir in path.Split(';'))
        {
            string d = dir.Trim().Trim('"');
            // Skip the Microsoft Store "python.exe" alias, which only opens the Store.
            if (d.Length == 0 || d.IndexOf("WindowsApps", StringComparison.OrdinalIgnoreCase) >= 0) continue;
            try
            {
                string full = Path.Combine(d, name);
                if (File.Exists(full)) return full;
            }
            catch (ArgumentException) { }
        }
        return null;
    }

    static bool InstallPython()
    {
        string winget = OnPath("winget.exe");
        string alias = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                                    @"Microsoft\WindowsApps\winget.exe");
        if (winget == null && File.Exists(alias)) winget = alias;
        if (winget == null)
        {
            Console.WriteLine("winget (App Installer) is not available on this PC.");
            return false;
        }

        Console.WriteLine();
        Console.WriteLine("Install Python 3.13 for this user now, using winget?");
        Console.WriteLine("This accepts the Python license and the winget source agreements.");
        Console.Write("Install? [Y/n]: ");
        string answer = Console.IsInputRedirected ? "" : (Console.ReadLine() ?? "");
        if (answer.Trim().StartsWith("n", StringComparison.OrdinalIgnoreCase)) return false;

        Console.WriteLine("Installing Python (this can take a few minutes)...");
        Run(winget, new List<string> { "install", "--id", WingetPythonId, "--exact", "--scope", "user", "--silent",
                                       "--accept-package-agreements", "--accept-source-agreements" }, null, false);
        return true;  // success is confirmed by looking for Python again
    }

    // ---------------------------------------------------------------- helpers

    static int Run(string exe, List<string> arguments, string workDir, bool quiet)
    {
        var psi = new ProcessStartInfo(exe, BuildArgs(arguments)) { UseShellExecute = false };
        if (workDir != null) psi.WorkingDirectory = workDir;
        if (quiet)
        {
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
        }
        try
        {
            using (Process p = Process.Start(psi))
            {
                if (quiet)
                {
                    p.StandardOutput.ReadToEnd();
                    p.StandardError.ReadToEnd();
                    if (!p.WaitForExit(20000)) { try { p.Kill(); } catch { } return -1; }
                }
                else p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception) { return -1; }
    }

    // Quote arguments the way the Windows C runtime parses them (CommandLineToArgvW rules).
    static string BuildArgs(List<string> arguments)
    {
        var sb = new StringBuilder();
        foreach (string a in arguments)
        {
            if (sb.Length > 0) sb.Append(' ');
            if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) { sb.Append(a); continue; }
            sb.Append('"');
            int slashes = 0;
            foreach (char ch in a)
            {
                if (ch == '\\') { slashes++; continue; }
                if (ch == '"') { sb.Append('\\', slashes * 2 + 1); sb.Append('"'); }
                else { sb.Append('\\', slashes); sb.Append(ch); }
                slashes = 0;
            }
            sb.Append('\\', slashes * 2);
            sb.Append('"');
        }
        return sb.ToString();
    }

    static int Fail(string message)
    {
        Console.Error.WriteLine();
        Console.Error.WriteLine("[setup] ERROR: " + message);
        Pause();
        return 1;
    }

    static void Pause()
    {
        if (Console.IsInputRedirected) return;
        Console.WriteLine();
        Console.Write("Press Enter to close this window...");
        Console.ReadLine();
    }
}
