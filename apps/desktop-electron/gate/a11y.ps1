param([int]$ProcessId)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ProcessId)
$win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
if (-not $win) { '{"error":"no window for the process"}'; exit 0 }
function Find($name) {
  $c = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $name)
  $e = $win.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $c)
  if ($e) { $e.Current.ControlType.ProgrammaticName } else { $null }
}
$first = Find 'gate host field'
Start-Sleep -Seconds 2
@{ host = (Find 'gate host field'); page = (Find 'gate page field'); api = 'UI Automation' } | ConvertTo-Json -Compress
