cask "orden" do
  version "0.22.0"
  sha256 arm:   "6b554a51af05edfd738678ea227fdd437ed4f787c967fd39e9457667686b04a7",
         intel: "bb0d7e6a05ce1a56657c086cd4358c6c162cd80943f20fc69c620ef1fb4229cc"

  on_arm do
    url "https://github.com/lxorb/orden/releases/download/v#{version}/Orden-#{version}-macos-arm64.dmg",
        verified: "github.com/lxorb/orden/"
  end
  on_intel do
    url "https://github.com/lxorb/orden/releases/download/v#{version}/Orden-#{version}-macos-x64.dmg",
        verified: "github.com/lxorb/orden/"
  end
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
    "~/Library/Caches/so.orden.Orden.helper",
  ]

  caveats <<~EOS
    Orden is not notarized by Apple, so Gatekeeper refuses the quarantined copy
    Homebrew installs by default. Install it without the quarantine flag:

      brew install --cask --no-quarantine lxorb/tap/orden

  EOS
end
