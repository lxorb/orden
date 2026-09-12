# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# What the page calls the activity through: the insets, the system bars, what
# another app shared, what a tile asked for, the home screen's rows, the
# recogniser and an AI provider's key. The page asks for these methods by name, so
# a release build must not rename them. See MainActivity.kt, insets.ts,
# mobile/bridge.ts and ai/keys.ts.
-keepclassmembers class ch.emilvinu.nib.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}

# The two classes R8 reports missing, named exactly as its own
# `build/outputs/mapping/universalRelease/missing_rules.txt` names them.
#
# Both are JSR-305 annotations, and both are referenced by Tink, which is what
# `androidx.security:security-crypto` encrypts the key file with:
# `javax.annotation.Nullable` from `com.google.crypto.tink.PrimitiveSet` and
# eighty-six other places, and `javax.annotation.concurrent.GuardedBy` from
# `com.google.crypto.tink.KeysetManager` and three others. Neither is on the
# classpath and neither should be: they are compile-time annotations, no Android
# release ships them, and nothing loads them at runtime. R8 refuses to finish
# while a reference dangles, so it is told that these two are meant to.
#
# Named one at a time rather than as `javax.annotation.**`, so the next dependency
# that really is missing something still stops the build.
-dontwarn javax.annotation.Nullable
-dontwarn javax.annotation.concurrent.GuardedBy

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile