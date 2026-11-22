# Şehrin Efendileri Arşiv

Node.js + Express + Supabase tabanlı CS 1.6 istatistik ve haftalık arşiv uygulaması.

## Kurulum
1. Node.js 18 veya üzeri kurulu olmalı.
2. `npm install`
3. `.env.example` dosyasını `.env` olarak kopyalayıp ortam değişkenlerini doldurun.
4. `npm start`

## Mimari
- `config/`: ortam, Supabase ve SMTP yapılandırması
- `middleware/`, `routes/`, `controllers/`: HTTP katmanı
- `services/`: tarama, izleme, arşivleme ve bildirim iş mantığı
- `utils/`: metin, sayı ve tarih yardımcıları
- `jobs/`: üç dakikalık izleme zamanlayıcısı
- `public/`: HTML, CSS, JavaScript ve görseller

## Notlar
Veritabanı şeması bu uygulama tarafından değiştirilmez. İzleme durumu (`lastGoodSnapshot`, sıfırlama teyidi ve çalışma bayrakları) süreç belleğinde tutulur; Node.js yeniden başlatıldığında bellek durumu sıfırlanır.
