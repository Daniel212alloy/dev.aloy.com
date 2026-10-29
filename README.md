# Backend kecil (Node.js, tanpa dependensi)

Menyediakan: hitung kunjungan, like, buku tamu, dan form inquiry. Data disimpan di `data.json`.

## Menjalankan
```bash
ADMIN_TOKEN=isi-token-panjang \
ALLOWED_ORIGIN=https://USERNAME.github.io \
IP_SALT=isi-acak-apa-saja \
node server.js
```
Docker:
```bash
docker build -t daniel-api .
docker run -d --name daniel-api --restart=always -p 3000:3000 -v daniel-api-data:/data \
  -e ADMIN_TOKEN=isi-token-panjang -e ALLOWED_ORIGIN=https://USERNAME.github.io -e IP_SALT=isi-acak daniel-api
```
`ALLOWED_ORIGIN` harus persis domain frontend (tanpa path, tanpa `/` di akhir).
Pasang di belakang HTTPS (nginx, Caddy, atau Cloudflare Tunnel) dan set `TRUST_PROXY=1`
supaya IP pengunjung dibaca dari header proxy. Frontend di GitHub Pages memakai HTTPS,
jadi API juga wajib HTTPS.

## Menyambungkan ke frontend
Di `index.html`, isi `CFG.api` dengan URL API, mis. `api:'https://api.domainmu.com'`.
Kalau dikosongkan, halaman tetap jalan: like, kunjungan, dan buku tamu disembunyikan,
dan form inquiry membuka WhatsApp dengan teks yang sudah terisi.

## Endpoint
| Method | Path | Fungsi |
|---|---|---|
| GET | `/api/stats` | jumlah kunjungan dan like |
| POST | `/api/view` | tambah kunjungan (1 per pengunjung per 6 jam, bot diabaikan) |
| POST | `/api/like` | like (1 per pengunjung) |
| GET/POST | `/api/guestbook` | baca / kirim pesan (maks 3 kiriman per jam per pengunjung) |
| POST | `/api/contact` | kirim inquiry (disimpan, tidak tampil publik) |
| GET | `/api/admin/inquiries` | baca inquiry (butuh token) |
| DELETE | `/api/admin/guestbook/:id` | hapus pesan buku tamu (butuh token) |

Admin:
```bash
curl -H "Authorization: Bearer TOKEN" https://api.domainmu.com/api/admin/inquiries
curl -X DELETE -H "Authorization: Bearer TOKEN" https://api.domainmu.com/api/admin/guestbook/ID
```
IP pengunjung tidak disimpan mentah, hanya hash bergaram. Backup cukup dengan menyalin `data.json`.
