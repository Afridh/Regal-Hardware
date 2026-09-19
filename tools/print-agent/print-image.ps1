# Prints an image on a named Windows printer, scaled to the printable width — the print helper's last step.
#   powershell -File print-image.ps1 -Printer "EPSON TM-T82 Receipt" -Image bill.png [-Paper A5] [-Landscape] [-Roll]
param(
  [Parameter(Mandatory=$true)][string]$Printer,
  [Parameter(Mandatory=$true)][string]$Image,
  [string]$Paper = '',
  [switch]$Landscape,
  [switch]$Roll
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile($Image)
$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $Printer
if (-not $doc.PrinterSettings.IsValid) { throw "Printer not found: $Printer" }
$doc.DocumentName = 'Regal Hardware bill'
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
if ($Paper) {
  $ps = $doc.PrinterSettings.PaperSizes | Where-Object { $_.PaperName -like "*$Paper*" } | Select-Object -First 1
  if ($ps) { $doc.DefaultPageSettings.PaperSize = $ps }
}
if ($Roll) {
  # a receipt printer: pick the roll paper (about 80 mm wide) and make the page as long as the receipt
  $ps = $doc.PrinterSettings.PaperSizes | Where-Object { $_.Width -ge 280 -and $_.Width -le 330 } | Sort-Object Height -Descending | Select-Object -First 1
  $wIn = if ($ps) { $ps.Width } else { 315 }
  $hIn = [int][Math]::Ceiling($wIn * $img.Height / $img.Width) + 20
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Receipt', $wIn, $hIn)
}
$doc.DefaultPageSettings.Landscape = [bool]$Landscape
$script:printed = $false
$doc.add_PrintPage({
  param($sender, $e)
  $r = $e.PageBounds
  $hard = $e.PageSettings.HardMarginX
  $w = $r.Width - 2 * $hard
  $h = [int]($w * $img.Height / $img.Width)
  if (-not $Roll -and $h -gt $r.Height - 2 * $e.PageSettings.HardMarginY) { $h = $r.Height - 2 * $e.PageSettings.HardMarginY; $w = [int]($h * $img.Width / $img.Height) }
  $e.Graphics.DrawImage($img, [int](($r.Width - $w) / 2 - $hard), 0, $w, $h)
  $e.HasMorePages = $false
  $script:printed = $true
})
$doc.Print()
$img.Dispose()
if ($script:printed) { Write-Output "printed on $Printer" } else { throw 'nothing printed' }
