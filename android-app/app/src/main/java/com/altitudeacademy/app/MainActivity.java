package com.altitudeacademy.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.Message;
import android.os.SystemClock;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.window.OnBackInvokedDispatcher;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
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
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
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
 * • Opens on the landing page; its buttons lead into the app.
 * • Back button: closes the site's pop-ups / menus first (window.aeroBack),
 *   then walks back through the site; at the very start "press back again
 *   to exit" instead of closing at once. Offline screen with Retry.
 * • Checks the website for a newer APK and offers the update.
 * • Downloads made by the website (notes PDF/PNG, exports, files) are saved to
 *   Downloads/RankerNode through a small JavaScript bridge, and generated pages
 *   (certificates) can be saved as PDF with Android's print service.
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
    /** host of the page now shown in the main view — the download bridge only serves our own site */
    private volatile String mainHost = "";
    /** time of the last back press that had nowhere to go (for "press again to exit") */
    private long lastExitBackAt = 0;
    private boolean backPending = false;

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
        setupEdgeToEdge();

        /* Android 13+: the back gesture / button comes here (onBackPressed is not called
           on Android 16 for apps that target it) */
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::handleBack);
        }

        if (savedInstanceState != null && web.restoreState(savedInstanceState) != null) {
            // history restored after Android closed the app in the background
        } else {
            web.loadUrl(startUrl(getIntent()));
        }
        /* The Play Store version updates through Google Play only (Play policy). */
        if (!IS_PLAY_BUILD) maybeCheckForUpdate();
    }

    /** true in the Google Play build (flavor "play"); false in the APK from the website */
    private static final boolean IS_PLAY_BUILD = "play".equals(BuildConfig.STORE);

    /** Android 15+ draws the app behind the status and navigation bars: keep the website
        clear of them (and of the keyboard), with the bars in the brand colour. */
    private void setupEdgeToEdge() {
        if (Build.VERSION.SDK_INT < 35) return;          // older Android: the theme handles the bars
        root.setBackgroundColor(getColor(R.color.brand_dark));
        web.setBackgroundColor(Color.WHITE);
        WindowInsetsController c = getWindow().getInsetsController();
        if (c != null) {
            c.setSystemBarsAppearance(0, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                    | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        }
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsets.Type.ime());
            v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
            return WindowInsets.CONSUMED;
        });
        root.requestApplyInsets();
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
    public void onBackPressed() {                         // Android 12 and older
        handleBack();
    }

    private void handleBack() {
        if (fullscreenView != null) {
            exitFullscreen();
            return;
        }
        if (popup != null) {
            if (popup.canGoBack()) popup.goBack();
            else closePopup();
            return;
        }
        /* let the website close its own pop-up / menu or go up a page first */
        if (isOwnHost(mainHost) && !backPending) {
            backPending = true;
            web.evaluateJavascript(
                    "(function(){try{return !!(window.aeroBack&&window.aeroBack());}catch(e){return false;}})()",
                    value -> {
                        backPending = false;
                        if (!"true".equals(value)) backThroughHistory();
                    });
            return;
        }
        if (!backPending) backThroughHistory();
    }

    private void backThroughHistory() {
        if (web.canGoBack()) {
            web.goBack();
            return;
        }
        long now = SystemClock.uptimeMillis();
        if (now - lastExitBackAt < 2200) {
            finish();
        } else {
            lastExitBackAt = now;
            Toast.makeText(this, "Press back again to exit", Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------------ WebView

    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && "https".equalsIgnoreCase(data.getScheme()) && isOwnHost(hostOf(data))) {
            return data.toString();
        }
        return BuildConfig.START_URL;
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
        /* The website reads this: it hides "Get App" inside the app, and in the Google Play
           build ("Store/Play") it also hides buying, which Play policy requires. */
        s.setUserAgentString(s.getUserAgentString() + " RankerNodeApp/" + BuildConfig.VERSION_NAME
                + (IS_PLAY_BUILD ? " Store/Play" : ""));

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(w, true);   // payment gateway frames

        w.setBackgroundColor(Color.WHITE);
        if (isPopup) w.addJavascriptInterface(new PrintBridge(w), "RankerNodePrint");
        else w.addJavascriptInterface(new DownloadBridge(), "RankerNodeAndroid");
        w.setWebViewClient(new AppWebViewClient(isPopup));
        w.setWebChromeClient(new AppChromeClient());
        w.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            Uri u = Uri.parse(url);
            String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase(Locale.ROOT);
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            boolean ours = !isPopup && isOwnHost(mainHost);
            if (ours && (scheme.equals("blob") || scheme.equals("data")
                    || ((scheme.equals("https")) && isOwnHost(hostOf(u))))) {
                /* the page itself fetches the file (with the student's login) and streams it to us */
                web.evaluateJavascript("window.__aeroSaveUrl && window.__aeroSaveUrl("
                        + JSONObject.quote(url) + "," + JSONObject.quote(name) + ")", null);
            } else if (scheme.equals("http") || scheme.equals("https")) {
                openExternal(u);
            } else {
                toast("This file can't be downloaded in the app.");
            }
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
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            if (view == web) mainHost = hostOf(Uri.parse(url));
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (view == web) { progress.setVisibility(View.GONE); mainHost = hostOf(Uri.parse(url)); }
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
            web.loadUrl(lastFailedUrl != null ? lastFailedUrl : BuildConfig.START_URL);
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

        TextView pdf = new TextView(this);
        pdf.setText("Save PDF");
        pdf.setTextColor(Color.WHITE);
        pdf.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        pdf.setGravity(Gravity.CENTER);
        pdf.setPadding(dp(12), 0, dp(4), 0);
        pdf.setContentDescription("Save this page as a PDF");
        pdf.setOnClickListener(v -> { if (popup != null) printPage(popup); });
        bar.addView(pdf, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)));

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

    // ------------------------------------------------------------------ downloads & PDF

    /**
     * Files the website creates or fetches (notes PDF/PNG, exports…) arrive here
     * in base64 chunks: begin(name, mime) → chunk(…) × n → end(). They are written
     * straight to Downloads/RankerNode, so memory use stays small even for big files.
     */
    private class DownloadBridge {
        private OutputStream out;
        private Uri outUri;
        private File outFile;
        private String outName = "", outMime = "";

        private boolean allowed() { return isOwnHost(mainHost); }

        @JavascriptInterface
        public String version() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public synchronized String begin(String name, String mime) {
            if (!allowed()) return "denied";
            closeQuietly();
            try {
                outName = cleanName(name);
                outMime = TextUtils.isEmpty(mime) ? guessMime(outName) : mime;
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, outName);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, outMime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/RankerNode");
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    outUri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (outUri == null) return "error";
                    out = getContentResolver().openOutputStream(outUri);
                } else {
                    File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                    if (dir == null) dir = new File(getFilesDir(), "Download");
                    if (!dir.exists() && !dir.mkdirs()) return "error";
                    outFile = uniqueFile(dir, outName);
                    out = new FileOutputStream(outFile);
                    outUri = FileProvider.getUriForFile(MainActivity.this, getPackageName() + ".files", outFile);
                }
                return out == null ? "error" : "ok";
            } catch (Exception e) {
                closeQuietly();
                return "error";
            }
        }

        @JavascriptInterface
        public synchronized boolean chunk(String b64) {
            if (out == null) return false;
            try {
                out.write(Base64.decode(b64, Base64.DEFAULT));
                return true;
            } catch (Exception e) {
                abort();
                return false;
            }
        }

        @JavascriptInterface
        public synchronized void end() {
            if (out == null) return;
            try {
                out.close();
                out = null;
                if (Build.VERSION.SDK_INT >= 29 && outUri != null) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.IS_PENDING, 0);
                    getContentResolver().update(outUri, v, null, null);
                }
                final Uri uri = outUri;
                final String name = outName, mime = outMime;
                runOnUiThread(() -> showSaved(uri, name, mime));
            } catch (Exception e) {
                abort();
                runOnUiThread(() -> toast("Could not save the file."));
            }
        }

        @JavascriptInterface
        public synchronized void abort() {
            closeQuietly();
            try {
                if (outUri != null && Build.VERSION.SDK_INT >= 29) getContentResolver().delete(outUri, null, null);
                if (outFile != null) //noinspection ResultOfMethodCallIgnored
                    outFile.delete();
            } catch (Exception ignored) { }
            outUri = null;
            outFile = null;
        }

        /** the main page asks to print / save as PDF (e.g. a certificate) */
        @JavascriptInterface
        public void print() {
            if (!allowed()) return;
            runOnUiThread(() -> printPage(web));
        }

        private void closeQuietly() {
            try { if (out != null) out.close(); } catch (Exception ignored) { }
            out = null;
        }
    }

    /** pop-up pages written by the site (certificates) call RankerNodePrint.print() */
    private class PrintBridge {
        private final WebView target;
        PrintBridge(WebView target) { this.target = target; }

        @JavascriptInterface
        public void print() {
            runOnUiThread(() -> { if (target == popup) printPage(target); });
        }
    }

    private void printPage(WebView view) {
        try {
            PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
            String title = view.getTitle();
            if (TextUtils.isEmpty(title) || title.startsWith("about:")) title = "RankerNode";
            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(title);
            pm.print(title, adapter, new PrintAttributes.Builder()
                    .setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
        } catch (Exception e) {
            toast("Printing is not available on this phone.");
        }
    }

    private void showSaved(Uri uri, String name, String mime) {
        if (isFinishing()) return;
        new AlertDialog.Builder(this)
                .setTitle("Saved")
                .setMessage("“" + name + "” is saved in " + (Build.VERSION.SDK_INT >= 29 ? "Downloads › RankerNode." : "the app's Downloads folder."))
                .setPositiveButton("Open", (d, w) -> openSaved(uri, mime, false))
                .setNeutralButton("Share", (d, w) -> openSaved(uri, mime, true))
                .setNegativeButton("OK", null)
                .show();
    }

    private void openSaved(Uri uri, String mime, boolean share) {
        try {
            Intent i;
            if (share) {
                i = new Intent(Intent.ACTION_SEND);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_STREAM, uri);
            } else {
                i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, mime);
            }
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(i, share ? "Share" : "Open with"));
        } catch (Exception e) {
            toast("No app on this phone can open this file.");
        }
    }

    private static String cleanName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\u0000-\\u001f]+", " ").trim();
        if (n.isEmpty()) n = "RankerNode-" + System.currentTimeMillis();
        if (n.length() > 120) n = n.substring(n.length() - 120);
        return n;
    }

    private static String guessMime(String name) {
        int dot = name.lastIndexOf('.');
        String m = dot > 0 ? MimeTypeMap.getSingleton().getMimeTypeFromExtension(name.substring(dot + 1).toLowerCase(Locale.ROOT)) : null;
        return m == null ? "application/octet-stream" : m;
    }

    private static File uniqueFile(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        int dot = name.lastIndexOf('.');
        String base = dot > 0 ? name.substring(0, dot) : name, ext = dot > 0 ? name.substring(dot) : "";
        for (int i = 1; i < 1000; i++) {
            f = new File(dir, base + " (" + i + ")" + ext);
            if (!f.exists()) return f;
        }
        return new File(dir, System.currentTimeMillis() + "-" + name);
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
