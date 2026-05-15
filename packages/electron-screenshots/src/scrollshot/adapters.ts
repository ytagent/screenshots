import { execFile } from 'node:child_process';
import { screen, type Rectangle, type WebContents } from 'electron';
import type {
  CapturedFrame,
  FrameCaptureAdapter,
  ScrollAdapter,
  ScrollState,
} from 'scrollshot-session';
import type { Bounds, ScreenshotsData } from '../preload.js';
import { nativeImageToPixelImage } from './nativeImage.js';

export interface ScrollshotCaptureAdapter {
  capture(data: ScreenshotsData): Promise<Buffer>;
}

export interface PlatformScrollResult {
  ok: boolean;
  method: string;
  reason?: string;
  diagnostics?: Record<string, unknown>;
}

export interface ScrollshotScrollAdapter {
  scrollBy(
    bounds: Bounds,
    deltaY: number,
    display?: ScreenshotsData['display'],
  ): Promise<PlatformScrollResult>;
}

export class ElectronControlledContentScrollAdapter
  implements ScrollshotScrollAdapter
{
  public async scrollBy(): Promise<PlatformScrollResult> {
    return {
      ok: false,
      method: 'electron-controlled-content',
      reason:
        'Use ElectronControlledContentAdapter for automatic controlled-content scrolling.',
    };
  }
}

export class ElectronControlledContentAdapter
  implements FrameCaptureAdapter, ScrollAdapter
{
  public constructor(
    private readonly webContents: WebContents,
    private readonly captureRect?: Rectangle,
  ) {}

  public async captureFrame(): Promise<CapturedFrame> {
    const image =
      this.captureRect === undefined
        ? await this.webContents.capturePage()
        : await this.webContents.capturePage(this.captureRect);
    const frame: CapturedFrame = {
      image: nativeImageToPixelImage(image),
      timestamp: Date.now(),
      deviceScaleFactor: 1,
    };
    if (this.captureRect) {
      frame.captureRect = this.captureRect;
    }
    return frame;
  }

  public async scrollBy(deltaY: number): Promise<ScrollState> {
    return this.webContents.executeJavaScript(
      `(() => {
        window.scrollBy(0, ${Math.round(deltaY)});
        return {
          scrollTop: window.scrollY,
          scrollHeight: document.documentElement.scrollHeight,
          viewportHeight: window.innerHeight,
          atBottom:
            window.scrollY + window.innerHeight >=
            document.documentElement.scrollHeight - 1
        };
      })()`,
    );
  }

  public async getState(): Promise<ScrollState> {
    return this.webContents.executeJavaScript(`(() => ({
      scrollTop: window.scrollY,
      scrollHeight: document.documentElement.scrollHeight,
      viewportHeight: window.innerHeight,
      atBottom:
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - 1
    }))()`);
  }
}

export class WindowsScrollAdapter implements ScrollshotScrollAdapter {
  public async scrollBy(
    bounds: Bounds,
    deltaY: number,
    display?: ScreenshotsData['display'],
  ): Promise<PlatformScrollResult> {
    const point = getCenterScreenPoint(bounds, display);
    const automationResult = await scrollWithWindowsAutomation(point, deltaY);
    if (automationResult.ok) {
      return withScrollDiagnostics(automationResult, {
        bounds,
        display,
        point,
        attempts: [automationResult],
      });
    }
    const wheelResult = await scrollWithWindowsWheel(point, deltaY);
    if (wheelResult.ok) {
      return withScrollDiagnostics(wheelResult, {
        bounds,
        display,
        point,
        attempts: [automationResult, wheelResult],
      });
    }
    return {
      ...withScrollDiagnostics(
        {
          ok: false,
          method: `${automationResult.method} -> ${wheelResult.method}`,
          reason: [automationResult.reason, wheelResult.reason]
            .filter(Boolean)
            .join('\n'),
        },
        {
          bounds,
          display,
          point,
          attempts: [automationResult, wheelResult],
        },
      ),
    };
  }
}

async function scrollWithWindowsAutomation(
  point: { x: number; y: number },
  deltaY: number,
): Promise<PlatformScrollResult> {
  const verticalAmount =
    deltaY >= 0
      ? '[System.Windows.Automation.ScrollAmount]::SmallIncrement'
      : '[System.Windows.Automation.ScrollAmount]::SmallDecrement';
  const repeatCount = Math.max(
    1,
    Math.min(12, Math.round(Math.abs(deltaY) / 40)),
  );
  const verticalAmountName =
    deltaY >= 0 ? 'SmallIncrement' : 'SmallDecrement';
  const script = `
Add-Type -AssemblyName WindowsBase
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Convert-Element($element) {
  $current = $element.Current
  $rect = $current.BoundingRectangle
  $bounds = $null
  if (!$rect.IsEmpty) {
    $bounds = [ordered]@{
      x = [Math]::Round($rect.X, 2)
      y = [Math]::Round($rect.Y, 2)
      width = [Math]::Round($rect.Width, 2)
      height = [Math]::Round($rect.Height, 2)
    }
  }
  return [ordered]@{
    name = $current.Name
    automationId = $current.AutomationId
    className = $current.ClassName
    controlType = $current.ControlType.ProgrammaticName
    isEnabled = $current.IsEnabled
    isOffscreen = $current.IsOffscreen
    boundingRectangle = $bounds
  }
}
$point = New-Object System.Windows.Point(${point.x}, ${point.y})
$element = [System.Windows.Automation.AutomationElement]::FromPoint($point)
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$ancestors = @()
while ($null -ne $element) {
  $ancestors += Convert-Element $element
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.ScrollPattern]::Pattern, [ref]$pattern)) {
    for ($i = 0; $i -lt ${repeatCount}; $i++) {
      $pattern.Scroll([System.Windows.Automation.ScrollAmount]::NoAmount, ${verticalAmount})
      Start-Sleep -Milliseconds 20
    }
    $target = Convert-Element $element
    [pscustomobject]@{
      point = @{ x = ${point.x}; y = ${point.y} }
      target = $target
      inspectedAncestors = $ancestors
      repeatCount = ${repeatCount}
      verticalAmount = "${verticalAmountName}"
      horizontallyScrollable = $pattern.Current.HorizontallyScrollable
      verticallyScrollable = $pattern.Current.VerticallyScrollable
      horizontalPercent = $pattern.Current.HorizontalScrollPercent
      verticalPercent = $pattern.Current.VerticalScrollPercent
      horizontalViewSize = $pattern.Current.HorizontalViewSize
      verticalViewSize = $pattern.Current.VerticalViewSize
    } | ConvertTo-Json -Depth 8 -Compress
    exit 0
  }
  $element = $walker.GetParent($element)
}
[pscustomobject]@{
  point = @{ x = ${point.x}; y = ${point.y} }
  inspectedAncestors = $ancestors
  reason = "No UI Automation ScrollPattern was found at ${point.x},${point.y}"
} | ConvertTo-Json -Depth 8 -Compress
Write-Error "No UI Automation ScrollPattern was found at ${point.x},${point.y}"
exit 2
`;
  try {
    const output = await runCommandDetailed(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ],
      2500,
    );
    return {
      ok: true,
      method: 'windows-uia-scroll-pattern',
      diagnostics: parseCommandJson(output.stdout),
    };
  } catch (err) {
    const commandFailure = commandFailureDetails(err);
    return {
      ok: false,
      method: 'windows-uia-scroll-pattern',
      reason: errorMessage(err),
      diagnostics: {
        ...parseCommandJson(commandFailure?.stdout),
        stderr: commandFailure?.stderr,
        code: commandFailure?.code,
        signal: commandFailure?.signal,
      },
    };
  }
}

async function scrollWithWindowsWheel(
  point: { x: number; y: number },
  deltaY: number,
): Promise<PlatformScrollResult> {
  const wheelDelta = deltaY >= 0 ? -wheelTicks(deltaY) : wheelTicks(deltaY);
  const script = `
Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern bool SetCursorPos(int X, int Y);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern void mouse_event(uint dwFlags, uint dx, uint dy, int dwData, System.UIntPtr dwExtraInfo);
'@
[Win32.NativeMethods]::SetCursorPos(${point.x}, ${point.y}) | Out-Null
Start-Sleep -Milliseconds 20
[Win32.NativeMethods]::mouse_event(0x0800, 0, 0, ${wheelDelta}, [System.UIntPtr]::Zero)
[pscustomobject]@{
  point = @{ x = ${point.x}; y = ${point.y} }
  wheelDelta = ${wheelDelta}
} | ConvertTo-Json -Depth 4 -Compress
`;
  try {
    const output = await runCommandDetailed(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ],
      2500,
    );
    return {
      ok: true,
      method: 'windows-mouse-wheel',
      diagnostics: parseCommandJson(output.stdout),
    };
  } catch (err) {
    const commandFailure = commandFailureDetails(err);
    return {
      ok: false,
      method: 'windows-mouse-wheel',
      reason: errorMessage(err),
      diagnostics: {
        ...parseCommandJson(commandFailure?.stdout),
        stderr: commandFailure?.stderr,
        code: commandFailure?.code,
        signal: commandFailure?.signal,
      },
    };
  }
}

export class MacOSScrollAdapter implements ScrollshotScrollAdapter {
  public async scrollBy(
    bounds: Bounds,
    deltaY: number,
    display?: ScreenshotsData['display'],
  ): Promise<PlatformScrollResult> {
    const point = getCenterScreenPoint(bounds, display);
    const direction = deltaY >= 0 ? 'down' : 'up';
    const notches = Math.max(1, Math.min(8, Math.round(Math.abs(deltaY) / 120)));
    const accessibility = await inspectMacOSAccessibilityPermission();
    if (!accessibility.trusted) {
      return withScrollDiagnostics(
        {
          ok: false,
          method: 'macos-accessibility-wheel',
          reason:
            'macOS Accessibility permission is not granted for external automatic scrolling. Grant Accessibility access to the host app or use manual-assisted scrollshot.',
          diagnostics: accessibility,
        },
        {
          bounds,
          display,
          point,
          attempts: [
            {
              ok: false,
              method: 'macos-accessibility-preflight',
              reason:
                accessibility.reason ??
                'AXIsProcessTrusted returned false for the current process.',
              diagnostics: accessibility,
            },
          ],
        },
      );
    }

    try {
      const output = await runCommandDetailed(
        '/usr/bin/osascript',
        [
          '-e',
          `tell application "System Events" to set the mouse location to {${point.x}, ${point.y}}`,
          '-e',
          `tell application "System Events" to scroll ${direction} ${notches}`,
        ],
        2500,
      );
      return withScrollDiagnostics(
        {
          ok: true,
          method: 'macos-accessibility-wheel',
          diagnostics: {
            accessibility,
            direction,
            notches,
            stdout: output.stdout.trim() || undefined,
          },
        },
        {
          bounds,
          display,
          point,
          attempts: [
            {
              ok: true,
              method: 'macos-accessibility-wheel',
              diagnostics: {
                accessibility,
                direction,
                notches,
              },
            },
          ],
        },
      );
    } catch (err) {
      const commandFailure = commandFailureDetails(err);
      return {
        ...withScrollDiagnostics(
          {
            ok: false,
            method: 'macos-accessibility-wheel',
            reason: `${errorMessage(
              err,
            )}. macOS external automatic scrolling requires Accessibility permission for the host app.`,
            diagnostics: {
              accessibility,
              direction,
              notches,
              stdout: commandFailure?.stdout,
              stderr: commandFailure?.stderr,
              code: commandFailure?.code,
              signal: commandFailure?.signal,
            },
          },
          {
            bounds,
            display,
            point,
            attempts: [
              {
                ok: false,
                method: 'macos-accessibility-wheel',
                reason: errorMessage(err),
                diagnostics: {
                  accessibility,
                  direction,
                  notches,
                  stdout: commandFailure?.stdout,
                  stderr: commandFailure?.stderr,
                  code: commandFailure?.code,
                  signal: commandFailure?.signal,
                },
              },
            ],
          },
        ),
      };
    }
  }
}

export class LinuxX11ScrollAdapter implements ScrollshotScrollAdapter {
  public async scrollBy(
    bounds: Bounds,
    deltaY: number,
    display?: ScreenshotsData['display'],
  ): Promise<PlatformScrollResult> {
    const point = getCenterScreenPoint(bounds, display);
    const button = deltaY >= 0 ? '5' : '4';
    const repeat = Math.max(1, Math.min(8, Math.round(Math.abs(deltaY) / 120)));
    try {
      await runCommand(
        'xdotool',
        ['mousemove', String(point.x), String(point.y), 'click', '--repeat', String(repeat), button],
        2500,
      );
      return { ok: true, method: 'linux-xdotool-wheel' };
    } catch (err) {
      return {
        ok: false,
        method: 'linux-xdotool-wheel',
        reason: `${errorMessage(
          err,
        )}. Install xdotool or use manual-assisted scrollshot on Linux.`,
      };
    }
  }
}

export function createPlatformScrollAdapter(): ScrollshotScrollAdapter | null {
  if (process.platform === 'win32') {
    return new WindowsScrollAdapter();
  }
  if (process.platform === 'darwin') {
    return new MacOSScrollAdapter();
  }
  if (process.platform === 'linux') {
    return new LinuxX11ScrollAdapter();
  }
  return null;
}

function getCenterScreenPoint(
  bounds: Bounds,
  display?: ScreenshotsData['display'],
): { x: number; y: number } {
  const dipPoint = {
    x: Math.round((display?.x ?? 0) + bounds.x + bounds.width / 2),
    y: Math.round((display?.y ?? 0) + bounds.y + bounds.height / 2),
  };
  if (process.platform === 'win32') {
    const physicalPoint = screen.dipToScreenPoint(dipPoint);
    return {
      x: Math.round(physicalPoint.x),
      y: Math.round(physicalPoint.y),
    };
  }
  return dipPoint;
}

function wheelTicks(deltaY: number): number {
  return Math.max(120, Math.min(960, Math.round(Math.abs(deltaY) / 120) * 120));
}

interface CommandOutput {
  stdout: string;
  stderr: string;
}

class CommandFailure extends Error {
  public constructor(
    message: string,
    public readonly stdout: string,
    public readonly stderr: string,
    public readonly code?: string,
    public readonly signal?: string,
  ) {
    super(message);
    this.name = 'CommandFailure';
  }
}

function runCommand(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<void> {
  return runCommandDetailed(file, args, timeoutMs).then(() => undefined);
}

function runCommandDetailed(
  file: string,
  args: string[],
  timeoutMs: number,
): Promise<CommandOutput> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        windowsHide: true,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        const stdoutText = stdout.toString();
        const stderrText = stderr.toString();
        if (error) {
          const code =
            typeof error === 'object' &&
            error !== null &&
            'code' in error
              ? String(error.code)
              : undefined;
          const signal =
            typeof error === 'object' &&
            error !== null &&
            'signal' in error
              ? String(error.signal)
              : undefined;
          reject(
            new CommandFailure(
              [
                error.message,
                code ? `code=${code}` : undefined,
                signal ? `signal=${signal}` : undefined,
                stdoutText.trim(),
                stderrText.trim(),
              ]
                .filter(Boolean)
                .join('\n'),
              stdoutText,
              stderrText,
              code,
              signal,
            ),
          );
          return;
        }
        resolve({
          stdout: stdoutText,
          stderr: stderrText,
        });
      },
    );
    child.on('error', reject);
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function commandFailureDetails(err: unknown): CommandFailure | null {
  return err instanceof CommandFailure ? err : null;
}

async function inspectMacOSAccessibilityPermission(): Promise<
  Record<string, unknown> & { trusted: boolean; reason?: string }
> {
  const script =
    'ObjC.import("ApplicationServices"); $.AXIsProcessTrusted() ? "true" : "false"';
  try {
    const output = await runCommandDetailed(
      '/usr/bin/osascript',
      ['-l', 'JavaScript', '-e', script],
      2500,
    );
    const trusted = output.stdout.trim() === 'true';
    if (trusted) {
      return {
        trusted,
        api: 'AXIsProcessTrusted',
        stdout: output.stdout.trim(),
      };
    }
    return {
      trusted,
      api: 'AXIsProcessTrusted',
      stdout: output.stdout.trim(),
      reason: 'AXIsProcessTrusted returned false for the current process.',
    };
  } catch (err) {
    const commandFailure = commandFailureDetails(err);
    return {
      trusted: false,
      api: 'AXIsProcessTrusted',
      reason: errorMessage(err),
      stdout: commandFailure?.stdout,
      stderr: commandFailure?.stderr,
      code: commandFailure?.code,
      signal: commandFailure?.signal,
    };
  }
}

function withScrollDiagnostics(
  result: PlatformScrollResult,
  context: {
    bounds: Bounds;
    display: ScreenshotsData['display'] | undefined;
    point: { x: number; y: number };
    attempts: PlatformScrollResult[];
  },
): PlatformScrollResult {
  return {
    ...result,
    diagnostics: {
      platform: process.platform,
      method: result.method,
      ok: result.ok,
      reason: result.reason,
      bounds: context.bounds,
      display: context.display
        ? {
            id: context.display.id,
            x: context.display.x,
            y: context.display.y,
            width: context.display.width,
            height: context.display.height,
            scaleFactor: context.display.scaleFactor,
          }
        : undefined,
      screenPoint: context.point,
      attempts: context.attempts.map((attempt) => ({
        method: attempt.method,
        ok: attempt.ok,
        reason: attempt.reason,
        details: attempt.diagnostics,
      })),
    },
  };
}

function parseCommandJson(stdout?: string): Record<string, unknown> {
  if (!stdout) {
    return {};
  }

  const text = stdout.trim();
  if (!text) {
    return {};
  }

  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : { value: parsed };
  } catch {
    const jsonLine = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .reverse()
      .find((line) => line.startsWith('{') && line.endsWith('}'));
    if (!jsonLine) {
      return { stdout: text };
    }
    try {
      const parsed = JSON.parse(jsonLine);
      return isRecord(parsed) ? parsed : { value: parsed };
    } catch {
      return { stdout: text };
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
