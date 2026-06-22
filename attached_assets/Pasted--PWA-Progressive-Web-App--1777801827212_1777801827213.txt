أريدك أن تجعل تطبيقي قابلاً للتثبيت كـ PWA (Progressive Web App) بحيث يظهر للمستخدم اقتراح التثبيت تلقائياً في المتصفح (أيقونة ⊕ في شريط العنوان على Chrome/Edge، وشريط "إضافة إلى الشاشة الرئيسية" على الجوال). لا أريد زر تثبيت مخصص داخل التطبيق — أريد الاعتماد على السلوك الافتراضي للمتصفح.

نفّذ الخطوات التالية بالضبط:

═══════════════════════════════════════
1) أنشئ ملف manifest.json في مجلد public (أو ما يعادله في إطار العمل المستخدم)
═══════════════════════════════════════
يحتوي على الحقول التالية كحد أدنى:
- id: "/"
- name: "اسم التطبيق الكامل"
- short_name: "اسم قصير" (12 حرف أو أقل)
- description: وصف قصير
- start_url: "/"
- scope: "/"
- display: "standalone"  ← إلزامي
- display_override: ["standalone", "minimal-ui"]
- background_color: "#ffffff"
- theme_color: "#3b82f6"
- orientation: "any"
- lang: "ar"
- dir: "rtl"
- prefer_related_applications: false
- icons: مصفوفة فيها على الأقل أيقونتين 192x192 و 512x512 بصيغة PNG، مع purpose: "any"
  (يفضل إضافة الأحجام: 72, 96, 128, 144, 152, 192, 384, 512)

═══════════════════════════════════════
2) أنشئ ملف sw.js (Service Worker) في مجلد public
═══════════════════════════════════════
شرط أساسي: يجب أن يحتوي على معالج fetch فعّال (وليس فارغاً)، وإلا Chrome لن يعتبر التطبيق مؤهلاً للتثبيت.

استخدم استراتيجيات الكاش التالية:
- طلبات /api/* → networkOnly (دائماً من الشبكة، بدون كاش)
- طلبات navigate (HTML pages) → networkOnly مع fallback للكاش عند انقطاع الإنترنت
- ملفات .js و .css → networkFirst (شبكة أولاً، ثم كاش)
- باقي الأصول (صور، خطوط، إلخ) → staleWhileRevalidate

أضف:
- معالج install يستدعي self.skipWaiting()
- معالج activate ينظف الكاشات القديمة ويستدعي self.clients.claim()
- معالج message يدعم رسائل SKIP_WAITING و CLEAR_CACHE
- استخدم اسم كاش مع رقم نسخة (مثال: 'app-v1') لسهولة الترقية لاحقاً
- تجاهل الطلبات غير http/https وتجاهل غير GET

═══════════════════════════════════════
3) عدّل index.html (أو الـ template الرئيسي)
═══════════════════════════════════════
أضف داخل <head>:

<!-- PWA Meta Tags -->
<meta name="theme-color" content="#3b82f6" />
<meta name="background-color" content="#ffffff" />
<meta name="application-name" content="اسم التطبيق" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<meta name="apple-mobile-web-app-title" content="اسم التطبيق" />
<meta name="mobile-web-app-capable" content="yes" />

<!-- Manifest -->
<link rel="manifest" href="/manifest.json" />

<!-- Icons -->
<link rel="icon" type="image/png" sizes="32x32" href="/icons/icon-96x96.png" />
<link rel="apple-touch-icon" href="/icons/icon-192x192.png" />
<link rel="apple-touch-icon" sizes="152x152" href="/icons/icon-152x152.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-192x192.png" />

أضف قبل </body>:

<script>
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js')
        .then((reg) => console.log('SW registered:', reg.scope))
        .catch((err) => console.log('SW registration failed:', err));
    });
  }
</script>

═══════════════════════════════════════
4) ولّد الأيقونات
═══════════════════════════════════════
أنشئ مجلد public/icons/ وضع فيه أيقونات PNG بالأحجام التالية:
72, 96, 128, 144, 152, 192, 384, 512
(الإلزامي فقط 192 و 512، لكن يفضل توفير الباقي للأجهزة المختلفة).

═══════════════════════════════════════
5) تأكد من أن إطار العمل لا يتجاهل الملفات
═══════════════════════════════════════
- في Vite/Next/CRA: تأكد أن /sw.js و /manifest.json يتم تقديمهما من جذر الموقع (وليس تحت /assets/ أو هاش)
- لا تضع headers تمنع تسجيل الـ Service Worker
- الـ scope يجب أن يكون "/"

═══════════════════════════════════════
6) التحقق
═══════════════════════════════════════
بعد التنفيذ، افتح Chrome DevTools:
- Application → Manifest: لا توجد أخطاء حمراء
- Application → Service Workers: حالة "activated and running"
- Lighthouse → PWA audit: passing

ملاحظة مهمة: لن يظهر اقتراح التثبيت إلا على HTTPS أو localhost، ولن يظهر مرة أخرى إذا رفضه المستخدم سابقاً (جرّب نافذة Incognito للاختبار).

نفّذ الآن جميع الخطوات أعلاه، ولا تستخدم أي مكتبة إضافية مثل vite-plugin-pwa أو workbox — اكتب الـ Service Worker يدوياً بالطريقة المذكورة.