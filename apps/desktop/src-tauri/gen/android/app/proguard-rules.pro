# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# What the page calls the activity through: the system bar insets and which way
# round the bars' own icons go. The page asks for these methods by name, so a
# release build must not rename them. See MainActivity.kt and insets.ts.
-keepclassmembers class ch.emilvinu.nib.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile