cask "orden" do
  version "0.20.0"
  sha256 "b1ff4100672e2771507f3d3a872202a2a0cfe7c531e6555f343f9124162a51f1"

  url "https://github.com/lxorb/orden/releases/download/v#{version}/Orden-#{version}-macos-universal.dmg",
      verified: "github.com/lxorb/orden/"
  name "Orden"
  name "nibeditor"
  desc "Markdown editor that styles formatting in place instead of showing syntax"
  homepage "https://orden.so/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :ventura"

  app "Orden.app"

  uninstall quit: "so.orden.Orden"

  zap trash: [
    "~/Library/Application Support/so.orden.Orden",
    "~/Library/Caches/so.orden.Orden",
    "~/Library/HTTPStorages/so.orden.Orden",
    "~/Library/Preferences/so.orden.Orden.plist",
    "~/Library/Saved Application State/so.orden.Orden.savedState",
    "~/Library/WebKit/so.orden.Orden",
  ]

  caveats <<~EOS
    Orden is not notarized by Apple, so Gatekeeper refuses the quarantined copy
    Homebrew installs by default. Install it without the quarantine flag:

      brew install --cask --no-quarantine lxorb/tap/orden

  EOS
end
