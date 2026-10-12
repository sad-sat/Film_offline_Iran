# Offline Persian Cinema & Series Catalog (آرشیو آفلاین فیلم و سریال)

<div align="center">

![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla%20ES6+-F7DF1E?logo=javascript&logoColor=black)
![Offline First](https://img.shields.io/badge/Architecture-Offline--First-blueviolet)
![Python](https://img.shields.io/badge/Parser-Python%203-3776AB?logo=python&logoColor=white)
![Dependencies](https://img.shields.io/badge/Dependencies-Zero%20External-success)
![CSS3](https://img.shields.io/badge/UI-Modern%20Dark%20Theme-1572B6?logo=css3&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-blue.svg)

**Zero-Dependency, Client-Side Search Engine & Archive Explorer for Persian Movies and Series.**

[English Documentation](#english-documentation) • [راهنمای جامع فارسی](#راهنمای-جامع-فارسی-persian-guide)

</div>

---

<a name="english-documentation"></a>
## Overview

During nationwide or localized internet connectivity outages, accessing cloud-hosted streaming platforms or online movie databases becomes impossible. 

**Film_offline_Iran** is an offline-first single-page catalog application (SPA) built to browse, search, and manage a massive indexed archive of movies and TV series with zero external internet dependencies. All dataset assets, metadata, media links, and Persian fonts are bundled locally.

---

## Key Features

- **Instant In-Memory Search**: Sub-millisecond debounced full-text search across thousands of indexed titles, Persian names, and English transliterations.
- **Multi-Faceted Filtering & Sorting**:
  - Filter by Media Type (Movies vs. TV Series).
  - Filter by Genre (Drama, Action, Sci-Fi, Crime, Animation, etc.).
  - Filter by Release Decade (1990s, 2000s, 2010s, 2020s+).
  - Sort by release date, alphabetical title, or catalog order.
- **Rich Media Modals**: Detailed modal views showcasing synopsis, season/episode tables, and direct download/stream links categorized by video quality (1080p, 720p, 480p, x265).
- **Infinite Virtualized Grid**: Chunked lazy rendering (batch loading) ensuring butter-smooth 60 FPS scrolling even with massive datasets.
- **Adaptive Dark / Light Theme**: Built-in persistence via `localStorage`.
- **Python Data Extraction Pipeline**: Included parser (`parse_archive.py`) to scrape, clean, deduplicate, and convert HTML archives into compact, structured JSON.

---

## Architecture & Data Pipeline

```mermaid
graph LR
    HTML["Web / HTML Archive (donyaye_serial_all_archive.html)"] -->|parse_archive.py| Parser["Python Data Extraction Pipeline"]
    Parser --> JSON["movies.json & data.js (7.8 MB In-Memory Store)"]
    JSON --> App["Vanilla JS Virtual Engine (app.js)"]
    App --> UI["Interactive Grid & Search (index.html)"]
```

---

## Quick Start

### Option 1: Direct File Launch (No Web Server Needed)
Simply open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge):
```bash
# Windows
start index.html

# macOS
open index.html

# Linux
xdg-open index.html
```

### Option 2: Local HTTP Server (Recommended)
```bash
# Using Python built-in server:
python -m http.server 8080
```
Then navigate to: `http://localhost:8080`

---

## Project Structure

```text
├── index.html                  # Main SPA entry point
├── app.js                      # Core reactive application logic & state machine
├── index.css                   # Responsive dark/light UI styling
├── data.js                     # Pre-compiled standalone JavaScript dataset
├── movies.json                 # Raw structured JSON catalog
├── parse_archive.py            # Python scraper & ETL data pipeline
├── fonts/                      # Embedded Persian typography
└── donyaye_serial_all_archive.html # Source raw archive snapshot
```

---

<a name="راهنمای-جامع-فارسی-persian-guide"></a>
## راهنمای جامع فارسی (Persian Guide)

این پروژه یک وب‌اپلیکیشن مستقل (Offline-First SPA) است که برای جستجو، کاوش و مرور آرشیو کامل فیلم‌ها و سریال‌ها با سرعت فوق‌العاده بالا طراحی شده است.

### ویژگی‌های اصلی
* **کاملاً آفلاین:** بدون نیاز به اینترنت، وب‌سرور خارجی یا پایگاه‌داده ابری؛ تمام داده‌ها به صورت کلاینت‌ساید (Client-side) لود و جستجو می‌شوند.
* **موتور جستجوی لحظه‌ای:** جستجوی فوق‌سریع در نام فارسی، عنوان انگلیسی و توضیحات با الگوریتم Debounce.
* **فیلترهای پیشرفته:** فیلتر براساس نوع اثر (فیلم/سریال)، ژانر، دهه تولید و نحوه مرتب‌سازی.
* **نمایش لینک‌های دانلود و کیفیت:** مدال اختصاصی نمایش فصل‌ها، قسمت‌ها و کیفیت‌های مختلف (1080p ،720p ،x265).
* **پایپ‌لاین داده پایتون:** اسکریپت `parse_archive.py` جهت استخراج، اعتبارسنجی و تبدیل صفحات آرشیو وب به فرمت استاندارد JSON.

### نحوه اجرا
کافیست فایل `index.html` را در مرورگر خود باز کنید یا با دستور زیر یک وب‌سرور محلی سریع اجرا نمایید:
```bash
python -m http.server 8080
```
سپس آدرس `http://localhost:8080` را در مرورگر وارد کنید.

---

## License

This project is open-source under the **MIT License**.
