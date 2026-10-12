# Plain Java app with no reflection — the default Android rules are enough,
# plus: the JavaScript bridges are called by name from the web page.
-keep class com.altitudeacademy.app.MainActivity { *; }
-keepclassmembers class com.altitudeacademy.app.MainActivity$* {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
