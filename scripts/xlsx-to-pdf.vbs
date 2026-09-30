' Usage: cscript //nologo scripts/xlsx-to-pdf.vbs <dir> <name>  (reads <dir>\<name>.xlsx, writes <name>.pdf)
' Opens an export read-only in a NEW, hidden Excel instance, lists its pictures and
' prints it to PDF. Never touches another Excel window.
Dim dir, xl, wb, ws, s, out
dir = WScript.Arguments(0)
Set xl = CreateObject("Excel.Application")
On Error Resume Next
xl.Visible = False
xl.DisplayAlerts = False
xl.AskToUpdateLinks = False
Set wb = xl.Workbooks.Open(dir & "\" & WScript.Arguments(1) & ".xlsx", 0, True)
If Err.Number <> 0 Then WScript.Echo "open failed: " & Err.Description
Set ws = wb.Worksheets(1)
out = "shapes: " & ws.Shapes.Count & vbCrLf
For Each s In ws.Shapes
  If s.Type = 13 Then out = out & s.Name & ": " & s.TopLeftCell.Address(False, False) & " -> " & s.BottomRightCell.Address(False, False) & "  " & Round(s.Width) & "x" & Round(s.Height) & "pt" & vbCrLf
Next
out = out & "row46 hidden=" & ws.Rows(46).Hidden & " row56=" & ws.Rows(56).Hidden & " row57=" & ws.Rows(57).Hidden & " B67=" & ws.Range("B67").Text
WScript.Echo out
wb.ExportAsFixedFormat 0, dir & "\" & WScript.Arguments(1) & ".pdf"
If Err.Number <> 0 Then WScript.Echo "export failed: " & Err.Description
wb.Close False
xl.Quit
Set xl = Nothing
