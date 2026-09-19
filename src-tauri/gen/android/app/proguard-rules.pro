# Add project specific ProGuard rules here.
# You can control the set of applied configuration files using the
# proguardFiles setting in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# If your project uses WebView with JS, uncomment the following
# and specify the fully qualified class name to the JavaScript interface
# class:
#-keepclassmembers class fqcn.of.javascript.interface.for.webview {
#   public *;
#}

# Uncomment this to preserve the line number information for
# debugging stack traces.
#-keepattributes SourceFile,LineNumberTable

# Shizuku starts the control service by class name.
-keep class rikka.shizuku.ShizukuProvider { *; }
-keep class top.natsuu.mta.control.PrivilegedControlServiceImpl {
    <init>(android.content.Context);
    public *;
}

# Rust resolves these bridge methods through JNI by name, so R8 cannot see
# the call graph and would otherwise strip members such as virtualDisplayStatus.
-keep class top.natsuu.mta.RuntimeBridge { public *; }
-keep class top.natsuu.mta.SecretBridge { public *; }
-keep class top.natsuu.mta.control.ControlHost { public *; }

# If you keep the line number information, uncomment this to
# hide the original source file name.
#-renamesourcefileattribute SourceFile
