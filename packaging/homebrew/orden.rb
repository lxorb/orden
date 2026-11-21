cask "orden" do
  version "0.22.2"
  sha256 arm:   "271f874b0d86902ec70bb7d0c730b6267490075dc53314aaac77374da558c2fb",
         intel: "0d2933814ef631f8da034caa4f87943bf7ac2f1ed0219fe59b107202acb80fdd"

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
