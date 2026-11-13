cask "orden" do
  version "0.21.0"
  sha256 arm:   "25ee0e6d2ab8229006c0375d0d682d7b207b9cb235cf42049a8743755d4baf27",
         intel: "25ee0e6d2ab8229006c0375d0d682d7b207b9cb235cf42049a8743755d4baf27"

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
