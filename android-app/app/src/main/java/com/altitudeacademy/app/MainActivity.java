package com.altitudeacademy.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * RankerNode — the website as a real Android app.
 *
 * • Full-screen WebView: no browser bar, no browser badge on the icon.
 * • FLAG_SECURE: Android blocks screenshots and screen recording inside the app
 *   (and hides the content in the recent-apps switcher).
 * • File uploads (AI Doubt Solver, contributions) incl. taking a photo with the camera.
 * • Payment / bank pop-ups open inside the app; UPI apps open via their own links.
 * • Back button walks back through the site; offline screen with Retry.
 * • Checks the website for a newer APK and offers the update.
 */
public class MainActivity extends Activity {

    private static final int REQ_FILES = 4201;
    private static final long UPDATE_CHECK_EVERY_MS = 6L * 60 * 60 * 1000;

    /** Links to these sites open in their own apps / the browser. */
    private static final Set<String> EXTERNAL_HOSTS = new HashSet<>(Arrays.asList(
            "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com",
            "wa.me", "api.whatsapp.com", "web.whatsapp.com", "chat.whatsapp.com",
            "play.google.com", "maps.google.com", "maps.app.goo.gl",
            "linkedin.com", "www.linkedin.com", "instagram.com", "www.instagram.com",
            "facebook.com", "www.facebook.com", "m.facebook.com", "twitter.com", "x.com", "t.me"));

    private FrameLayout root;
    private WebView web;
    private ProgressBar progress;
    private LinearLayout popupBox;
    private WebView popup;
    private TextView popupTitle;
    private View fullscreenView;
    private WebChromeClient.CustomViewCallback fullscreenCallback;

    private ValueCallback<Uri[]> fileCallback;
    private Uri cameraUri;
    private File cameraFile;

    private String appHost;
    private String lastFailedUrl;

    // ------------------------------------------------------------------ lifecycle

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        /* Screenshots, screen recording and the recents thumbnail are blocked by Android. */
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);

        appHost = hostOf(Uri.parse(BuildConfig.APP_URL));
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        web = createWebView(false);
        root.addView(web, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        progress.setMax(100);
        progress.setIndeterminate(false);
        progress.setVisibility(View.GONE);
        FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3), Gravity.TOP);
        root.addView(progress, lp);

        setContentView(root);

        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) {
            // history restored after Android closed the app in the background
        } else {
            web.loadUrl(startUrl(getIntent()));
        }
        maybeCheckForUpdate();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && isOwnHost(hostOf(data))) {
            closePopup();
            web.loadUrl(data.toString());
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (popup != null) popup.destroy();
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (fullscreenView != null) {
            exitFullscreen();
            return;
        }
        if (popup != null) {
            if (popup.canGoBack()) popup.goBack();
            else closePopup();
            return;
        }
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        super.onBackPressed();
    }

    // ------------------------------------------------------------------ WebView

    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && "https".equalsIgnoreCase(data.getScheme()) && isOwnHost(hostOf(data))) {
            return data.toString();
        }
        return BuildConfig.APP_URL;
    }

    @SuppressLint("SetJavaScriptEnabled")
    private WebView createWebView(final boolean isPopup) {
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setSupportZoom(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        /* lets the website know it runs inside the app (hides "Get App" etc.) */
        s.setUserAgentString(s.getUserAgentString() + " AltitudeAcademyApp/" + BuildConfig.VERSION_NAME);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(w, true);   // payment gateway frames

        w.setBackgroundColor(Color.WHITE);
        w.setWebViewClient(new AppWebViewClient(isPopup));
        w.setWebChromeClient(new AppChromeClient());
        w.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            Uri u = Uri.parse(url);
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            if (scheme.equals("http") || scheme.equals("https")) openExternal(u);
            else toast("This file can't be downloaded in the app.");
        });
        return w;
    }

    private class AppWebViewClient extends WebViewClient {
        private final boolean isPopup;

        AppWebViewClient(boolean isPopup) {
            this.isPopup = isPopup;
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl(), isPopup);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (view == web) progress.setVisibility(View.GONE);
            if (isPopup && popupTitle != null) {
                String t = view.getTitle();
                popupTitle.setText(TextUtils.isEmpty(t) ? hostOf(Uri.parse(url)) : t);
            }
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame() && view == web) {
                lastFailedUrl = request.getUrl().toString();
                view.loadUrl("file:///android_asset/offline.html");
            }
        }
    }

    /** true = we handled it (do not load in this WebView). */
    private boolean handleNavigation(Uri uri, boolean fromPopup) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);

        if (scheme.equals("file") && "/android_asset/offline.html".equals(uri.getPath())) return false;

        if (scheme.equals("altitude") && "retry".equals(uri.getHost())) {      // from the offline page
            web.loadUrl(lastFailedUrl != null ? lastFailedUrl : BuildConfig.APP_URL);
            return true;
        }

        if (scheme.equals("http") || scheme.equals("https")) {
            String host = hostOf(uri);
            if (isOwnHost(host)) {
                if (fromPopup) {                    // a pop-up pointing back to our site → show it in the main view
                    closePopup();
                    web.loadUrl(uri.toString());
                    return true;
                }
                return false;
            }
            if (EXTERNAL_HOSTS.contains(host)) {
                openExternal(uri);
                if (fromPopup) closePopup();
                return true;
            }
            return false;                           // payment / bank pages stay in the app
        }

        if (scheme.equals("about") || scheme.equals("blob") || scheme.equals("data") || scheme.equals("javascript")) {
            return false;
        }

        /* intent:, upi:, tel:, mailto:, whatsapp:, market: … → the right app on the phone */
        Intent intent = null;
        try {
            if (scheme.equals("intent")) {
                intent = Intent.parseUri(uri.toString(), Intent.URI_INTENT_SCHEME);
                intent.addCategory(Intent.CATEGORY_BROWSABLE);
                intent.setComponent(null);
                intent.setSelector(null);
            } else {
                intent = new Intent(Intent.ACTION_VIEW, uri);
            }
            startActivity(intent);
        } catch (Exception e) {
            String fallback = intent != null ? intent.getStringExtra("browser_fallback_url") : null;
            if (!TextUtils.isEmpty(fallback)) {
                (fromPopup && popup != null ? popup : web).loadUrl(fallback);
            } else if (scheme.equals("upi")) {
                toast("No UPI app found on this phone. Please choose another payment method.");
            } else {
                toast("No app on this phone can open that link.");
            }
        }
        return true;
    }

    private class AppChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            if (view != web) return;
            progress.setProgress(newProgress);
            progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
        }

        @Override
        public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
            openPopup();
            WebView.WebViewTransport transport = (WebView.WebViewTransport) resultMsg.obj;
            transport.setWebView(popup);
            resultMsg.sendToTarget();
            return true;
        }

        @Override
        public void onCloseWindow(WebView window) {
            if (window == popup) closePopup();
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            return openFileChooser(callback, params);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullscreenView != null) {
                callback.onCustomViewHidden();
                return;
            }
            fullscreenView = view;
            fullscreenCallback = callback;
            view.setBackgroundColor(Color.BLACK);
            root.addView(view, new FrameLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            setFullscreenUi(true);
        }

        @Override
        public void onHideCustomView() {
            exitFullscreen();
        }

        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();                         // the site never needs camera/mic streams
        }
    }

    // ------------------------------------------------------------------ pop-up windows

    private void openPopup() {
        closePopup();
        popupBox = new LinearLayout(this);
        popupBox.setOrientation(LinearLayout.VERTICAL);
        popupBox.setBackgroundColor(Color.WHITE);

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setBackgroundColor(Color.parseColor("#0B1226"));
        bar.setPadding(dp(4), 0, dp(12), 0);

        TextView close = new TextView(this);
        close.setText("✕");
        close.setTextColor(Color.WHITE);
        close.setTextSize(TypedValue.COMPLEX_UNIT_SP, 20);
        close.setGravity(Gravity.CENTER);
        close.setContentDescription("Close");
        close.setOnClickListener(v -> closePopup());
        bar.addView(close, new LinearLayout.LayoutParams(dp(48), dp(48)));

        popupTitle = new TextView(this);
        popupTitle.setTextColor(Color.WHITE);
        popupTitle.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        popupTitle.setSingleLine(true);
        popupTitle.setEllipsize(TextUtils.TruncateAt.END);
        popupTitle.setText("Loading…");
        bar.addView(popupTitle, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        popupBox.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(52)));
        popup = createWebView(true);
        popupBox.addView(popup, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        root.addView(popupBox, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    private void closePopup() {
        if (popupBox == null) return;
        root.removeView(popupBox);
        if (popup != null) {
            popup.stopLoading();
            popup.destroy();
        }
        popup = null;
        popupBox = null;
        popupTitle = null;
    }

    // ------------------------------------------------------------------ full-screen video

    private void exitFullscreen() {
        if (fullscreenView == null) return;
        root.removeView(fullscreenView);
        fullscreenView = null;
        if (fullscreenCallback != null) fullscreenCallback.onCustomViewHidden();
        fullscreenCallback = null;
        setFullscreenUi(false);
    }

    @SuppressWarnings("deprecation")
    private void setFullscreenUi(boolean on) {
        View decor = getWindow().getDecorView();
        if (on) {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        } else {
            decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_VISIBLE);
        }
    }

    // ------------------------------------------------------------------ file uploads

    private boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;

        /* accept="image/*,.pdf,.docx" → MIME types the Android picker understands */
        Set<String> mimes = new LinkedHashSet<>();
        boolean images = false;
        String[] accept = params.getAcceptTypes();
        if (accept != null) {
            for (String raw : accept) {
                if (raw == null) continue;
                for (String part : raw.split(",")) {
                    String a = part.trim().toLowerCase(Locale.ROOT);
                    if (a.isEmpty()) continue;
                    if (a.startsWith(".")) {
                        String m = MimeTypeMap.getSingleton().getMimeTypeFromExtension(a.substring(1));
                        if (m != null) mimes.add(m);
                    } else {
                        mimes.add(a);
                    }
                    if (a.startsWith("image/")) images = true;
                }
            }
        }
        if (mimes.isEmpty()) images = true;

        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        if (mimes.size() == 1) {
            pick.setType(mimes.iterator().next());
        } else {
            pick.setType("*/*");
            if (!mimes.isEmpty()) pick.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        }
        pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);

        Intent camera = images ? cameraIntent() : null;
        try {
            if (params.isCaptureEnabled() && camera != null) {
                startActivityForResult(camera, REQ_FILES);             // "Photo" button → straight to the camera
            } else {
                Intent chooser = Intent.createChooser(pick, "Choose a file");
                if (camera != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
                startActivityForResult(chooser, REQ_FILES);
            }
            return true;
        } catch (ActivityNotFoundException e) {
            fileCallback = null;
            toast("No file picker found on this phone.");
            return false;
        }
    }

    private Intent cameraIntent() {
        try {
            File dir = new File(getCacheDir(), "camera");
            if (!dir.exists() && !dir.mkdirs()) return null;
            File[] old = dir.listFiles();
            if (old != null) for (File f : old) //noinspection ResultOfMethodCallIgnored
                f.delete();
            cameraFile = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
            cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", cameraFile);
            Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
            i.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
            i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            return i;
        } catch (Exception e) {
            cameraUri = null;
            cameraFile = null;
            return null;
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILES || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            List<Uri> uris = new ArrayList<>();
            if (data != null && data.getClipData() != null) {
                for (int i = 0; i < data.getClipData().getItemCount(); i++) {
                    Uri u = data.getClipData().getItemAt(i).getUri();
                    if (u != null) uris.add(u);
                }
            } else if (data != null && data.getData() != null) {
                uris.add(data.getData());
            }
            if (uris.isEmpty() && cameraUri != null && cameraFile != null && cameraFile.length() > 0) {
                uris.add(cameraUri);                                   // photo from the camera
            }
            if (!uris.isEmpty()) result = uris.toArray(new Uri[0]);
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    // ------------------------------------------------------------------ update check

    private void maybeCheckForUpdate() {
        final SharedPreferences prefs = getSharedPreferences("altitude", MODE_PRIVATE);
        long last = prefs.getLong("updateCheckedAt", 0);
        if (System.currentTimeMillis() - last < UPDATE_CHECK_EVERY_MS) return;
        prefs.edit().putLong("updateCheckedAt", System.currentTimeMillis()).apply();

        final Uri base = Uri.parse(BuildConfig.APP_URL);
        final String api = base.getScheme() + "://" + base.getAuthority() + "/api/app-release";
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = (HttpURLConnection) new URL(api).openConnection();
                c.setConnectTimeout(8000);
                c.setReadTimeout(8000);
                if (c.getResponseCode() != 200) return;
                InputStream in = c.getInputStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[4096];
                int n;
                while ((n = in.read(buf)) > 0 && out.size() < 64 * 1024) out.write(buf, 0, n);
                JSONObject android = new JSONObject(out.toString("UTF-8")).optJSONObject("android");
                if (android == null || !android.optBoolean("available")) return;
                final int remoteCode = android.optInt("versionCode", 0);
                final String remoteName = android.optString("version", "");
                final String url = android.optString("url", "");
                if (remoteCode <= BuildConfig.VERSION_CODE || TextUtils.isEmpty(url)) return;
                final String skipped = prefs.getString("skipVersion", "");
                if (remoteName.equals(skipped)) return;
                final String full = url.startsWith("http") ? url : base.getScheme() + "://" + base.getAuthority() + url;
                new Handler(Looper.getMainLooper()).post(() -> showUpdateDialog(remoteName, full, prefs));
            } catch (Exception ignored) {
                // offline or server busy — try again next time
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    private void showUpdateDialog(String version, String url, SharedPreferences prefs) {
        if (isFinishing()) return;
        new AlertDialog.Builder(this)
                .setTitle("Update available")
                .setMessage("A new version of RankerNode" + (TextUtils.isEmpty(version) ? "" : " (" + version + ")")
                        + " is ready. Download it now? Your account and progress stay as they are.")
                .setPositiveButton("Update", (d, w) -> openExternal(Uri.parse(url)))
                .setNegativeButton("Later", null)
                .setNeutralButton("Skip this version", (d, w) -> prefs.edit().putString("skipVersion", version).apply())
                .show();
    }

    // ------------------------------------------------------------------ helpers

    private boolean isOwnHost(String host) {
        if (TextUtils.isEmpty(host) || TextUtils.isEmpty(appHost)) return false;
        String bare = appHost.startsWith("www.") ? appHost.substring(4) : appHost;
        return host.equals(appHost) || host.equals(bare) || host.endsWith("." + bare);
    }

    private static String hostOf(Uri uri) {
        String h = uri != null ? uri.getHost() : null;
        return h == null ? "" : h.toLowerCase(Locale.ROOT);
    }

    private void openExternal(Uri uri) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, uri);
            i.addCategory(Intent.CATEGORY_BROWSABLE);
            startActivity(i);
        } catch (ActivityNotFoundException e) {
            toast("No app on this phone can open that link.");
        }
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }
}
