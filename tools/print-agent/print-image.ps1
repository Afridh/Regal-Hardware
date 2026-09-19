# Prints an image on a named Windows printer — the print helper's last step.
#   powershell -File print-image.ps1 -Printer "EPSON TM-T82 Receipt" -Image bill.png -Roll -Dpi 203
#   powershell -File print-image.ps1 -Printer "LBP6030w" -Image bill.png -Paper A5 -Landscape
# A roll (receipt) printer gets the image one pixel per printer dot, pure black on white, across the
# whole printable width.  A page printer gets it scaled to fit the page.
param(
  [Parameter(Mandatory=$true)][string]$Printer,
  [Parameter(Mandatory=$true)][string]$Image,
  [string]$Paper = '',
  [switch]$Landscape,
  [switch]$Roll,
  [int]$Dpi = 203
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$src = [System.Drawing.Image]::FromFile($Image)
$img = $src
if ($Roll) {
  # threshold to 1-bit black/white so the thermal head prints crisp text rather than dithered grey
  $bmp = New-Object System.Drawing.Bitmap $src.Width, $src.Height, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g0 = [System.Drawing.Graphics]::FromImage($bmp); $g0.Clear([System.Drawing.Color]::White); $g0.DrawImageUnscaled($src, 0, 0); $g0.Dispose()
  $rect = New-Object System.Drawing.Rectangle 0, 0, $bmp.Width, $bmp.Height
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadWrite, $bmp.PixelFormat)
  $bytes = New-Object byte[] ($data.Stride * $bmp.Height)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  for ($i = 0; $i -lt $bytes.Length; $i += 4) {
    $lum = (0.299 * $bytes[$i + 2] + 0.587 * $bytes[$i + 1] + 0.114 * $bytes[$i])
    $v = if ($lum -lt 160) { 0 } else { 255 }
    $bytes[$i] = $v; $bytes[$i + 1] = $v; $bytes[$i + 2] = $v; $bytes[$i + 3] = 255
  }
  [System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $data.Scan0, $bytes.Length)
  $bmp.UnlockBits($data)
  $img = $bmp
}
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
  # the roll paper (about 80 mm wide); page as long as the receipt, in hundredths of an inch
  $ps = $doc.PrinterSettings.PaperSizes | Where-Object { $_.Width -ge 280 -and $_.Width -le 330 } | Sort-Object Height -Descending | Select-Object -First 1
  $wIn = if ($ps) { $ps.Width } else { 315 }
  $hIn = [int][Math]::Ceiling($img.Height * 100 / $Dpi) + 16
  $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('Receipt', $wIn, $hIn)
}
$doc.DefaultPageSettings.Landscape = [bool]$Landscape
$script:printed = $false
$doc.add_PrintPage({
  param($sender, $e)
  $g = $e.Graphics
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $r = $e.PageBounds
  if ($Roll) {
    # one image pixel = one printer dot; start at the left edge of the printable area
    $w = $img.Width * 100.0 / $Dpi; $h = $img.Height * 100.0 / $Dpi
    $x = -$e.PageSettings.HardMarginX; $y = -$e.PageSettings.HardMarginY
    $g.DrawImage($img, [float]$x, [float]$y, [float]$w, [float]$h)
  } else {
    $hard = $e.PageSettings.HardMarginX
    $w = $r.Width - 2 * $hard
    $h = [int]($w * $img.Height / $img.Width)
    if ($h -gt $r.Height - 2 * $e.PageSettings.HardMarginY) { $h = $r.Height - 2 * $e.PageSettings.HardMarginY; $w = [int]($h * $img.Width / $img.Height) }
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.DrawImage($img, [int](($r.Width - $w) / 2 - $hard), 0, $w, $h)
  }
  $e.HasMorePages = $false
  $script:printed = $true
})
$doc.Print()
$img.Dispose(); if ($img -ne $src) { $src.Dispose() }
if ($script:printed) { Write-Output "printed on $Printer" } else { throw 'nothing printed' }
