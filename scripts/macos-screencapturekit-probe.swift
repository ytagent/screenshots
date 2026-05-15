import Foundation
import ScreenCaptureKit

func jsonEscape(_ value: String) -> String {
  var output = ""
  for scalar in value.unicodeScalars {
    switch scalar.value {
    case 34:
      output += "\\\""
    case 92:
      output += "\\\\"
    case 10:
      output += "\\n"
    case 13:
      output += "\\r"
    case 9:
      output += "\\t"
    default:
      if scalar.value < 0x20 {
        output += String(format: "\\u%04x", scalar.value)
      } else {
        output.unicodeScalars.append(scalar)
      }
    }
  }
  return output
}

func emit(_ fields: [(String, String)]) {
  let body = fields
    .map { "\"\($0.0)\":\($0.1)" }
    .joined(separator: ",")
  print("{\(body)}")
}

func jsonString(_ value: String) -> String {
  return "\"\(jsonEscape(value))\""
}

if #available(macOS 12.3, *) {
  let semaphore = DispatchSemaphore(value: 0)
  var exitCode: Int32 = 0
  var resultFields: [(String, String)] = [
    ("ok", "false"),
    ("api", jsonString("ScreenCaptureKit.SCShareableContent")),
  ]

  SCShareableContent.getExcludingDesktopWindows(
    false,
    onScreenWindowsOnly: true
  ) { content, error in
    if let error = error {
      let nsError = error as NSError
      resultFields += [
        ("domain", jsonString(nsError.domain)),
        ("code", "\(nsError.code)"),
        ("message", jsonString(nsError.localizedDescription)),
      ]
      exitCode = 2
    } else if let content = content {
      resultFields = [
        ("ok", "true"),
        ("api", jsonString("ScreenCaptureKit.SCShareableContent")),
        ("displays", "\(content.displays.count)"),
        ("windows", "\(content.windows.count)"),
        ("applications", "\(content.applications.count)"),
      ]
      exitCode = 0
    } else {
      resultFields += [
        ("message", jsonString("SCShareableContent returned no content and no error")),
      ]
      exitCode = 3
    }
    semaphore.signal()
  }

  if semaphore.wait(timeout: .now() + .seconds(8)) == .timedOut {
    emit([
      ("ok", "false"),
      ("api", jsonString("ScreenCaptureKit.SCShareableContent")),
      ("message", jsonString("ScreenCaptureKit probe timed out")),
    ])
    exit(4)
  }

  emit(resultFields)
  exit(exitCode)
} else {
  emit([
    ("ok", "false"),
    ("api", jsonString("ScreenCaptureKit.SCShareableContent")),
    ("message", jsonString("ScreenCaptureKit requires macOS 12.3 or newer")),
  ])
  exit(5)
}
