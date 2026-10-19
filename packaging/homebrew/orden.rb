cask "orden" do
  version "0.16.0"
  sha256 "52bffe5de734feb9b92f4c3b0a33cc92aaca648007283ebccc995c3648d87a7e"

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

  uninstall quit: "ch.emilvinu.nib"

  zap trash: [
    "~/Library/Application Support/ch.emilvinu.nib",
    "~/Library/Caches/ch.emilvinu.nib",
    "~/Library/HTTPStorages/ch.emilvinu.nib",
    "~/Library/Preferences/ch.emilvinu.nib.plist",
    "~/Library/Saved Application State/ch.emilvinu.nib.savedState",
    "~/Library/WebKit/ch.emilvinu.nib",
  ]

  caveats <<~EOS
    Orden is not notarized by Apple, so Gatekeeper refuses the quarantined copy
    Homebrew installs by default. Install it without the quarantine flag:

      brew install --cask --no-quarantine lxorb/tap/orden

  EOS
end
