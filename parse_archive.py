#!/usr/bin/env python3
"""
Parse donyaye_serial_all_archive.html and generate movies.json
"""
import re
import json
import html

# Well-known movie genre mappings (IMDb code -> Persian genre)
GENRE_MAP = {
    "tt0111161": "درام", "tt0468569": "اکشن، جنایی", "tt1375666": "اکشن، علمی‌تخیلی",
    "tt0137523": "درام", "tt0944947": "فانتزی، درام", "tt0903747": "جنایی، درام",
    "tt0816692": "علمی‌تخیلی، درام", "tt0109830": "درام، عاشقانه", "tt0110912": "جنایی، درام",
    "tt0133093": "اکشن، علمی‌تخیلی", "tt0068646": "جنایی، درام", "tt0120737": "فانتزی، ماجراجویی",
    "tt0167260": "فانتزی، ماجراجویی", "tt0114369": "جنایی، معمایی", "tt1345836": "اکشن",
    "tt0167261": "فانتزی، ماجراجویی", "tt1853728": "درام، وسترن", "tt0172495": "اکشن، درام",
    "tt0993846": "جنایی، کمدی", "tt0361748": "جنگی، درام", "tt0102926": "ترسناک، هیجان‌انگیز",
    "tt0372784": "اکشن", "tt7286456": "جنایی، درام", "tt4574334": "علمی‌تخیلی، ترسناک",
    "tt0120815": "جنگی، درام", "tt1130884": "هیجان‌انگیز، معمایی", "tt0108052": "درام، تاریخی",
    "tt0482571": "درام، معمایی", "tt0076759": "اکشن، علمی‌تخیلی", "tt0848228": "اکشن، علمی‌تخیلی",
    "tt0120689": "درام، فانتزی", "tt0407887": "جنایی، هیجان‌انگیز", "tt0080684": "اکشن، علمی‌تخیلی",
    "tt0499549": "اکشن، علمی‌تخیلی", "tt0071562": "جنایی، درام", "tt0088763": "ماجراجویی، کمدی",
    "tt4154796": "اکشن، علمی‌تخیلی", "tt0209144": "هیجان‌انگیز، معمایی", "tt0120338": "درام، عاشقانه",
    "tt0099685": "جنایی، درام", "tt2015381": "اکشن، کمدی", "tt4154756": "اکشن، علمی‌تخیلی",
    "tt0120382": "درام، کمدی", "tt0110413": "اکشن، جنایی", "tt0325980": "اکشن، ماجراجویی",
    "tt0910970": "انیمیشن، ماجراجویی", "tt0266697": "اکشن", "tt0169547": "درام",
    "tt0103064": "اکشن، علمی‌تخیلی", "tt0120586": "درام", "tt0110357": "انیمیشن، ماجراجویی",
    "tt1431045": "اکشن، کمدی", "tt0434409": "اکشن، درام", "tt0114814": "جنایی، هیجان‌انگیز",
    "tt1049413": "انیمیشن، ماجراجویی", "tt0264464": "جنایی، درام", "tt0081505": "ترسناک",
    "tt0371746": "اکشن، علمی‌تخیلی", "tt0086190": "اکشن، علمی‌تخیلی", "tt1392190": "اکشن",
    "tt0119217": "درام", "tt0266543": "انیمیشن، کمدی", "tt1520211": "ترسناک، درام",
    "tt0108778": "کمدی، عاشقانه", "tt0477348": "جنایی، هیجان‌انگیز",
    "tt0338013": "درام، عاشقانه", "tt0107290": "اکشن، علمی‌تخیلی", "tt0105236": "جنایی",
    "tt0114709": "انیمیشن، کمدی", "tt2267998": "هیجان‌انگیز، درام", "tt0112573": "اکشن، تاریخی",
}

# Well-known Persian titles
TITLE_FA_MAP = {
    "tt0111161": "رستگاری در شاوشنک", "tt0468569": "شوالیه تاریکی", "tt1375666": "تلقین",
    "tt0137523": "باشگاه مشت‌زنی", "tt0944947": "بازی تاج و تخت", "tt0903747": "بریکینگ بد",
    "tt0816692": "میان‌ستاره‌ای", "tt0109830": "فارست گامپ", "tt0110912": "داستان عامه‌پسند",
    "tt0133093": "ماتریکس", "tt0068646": "پدرخوانده", "tt0120737": "ارباب حلقه‌ها: یاران حلقه",
    "tt0167260": "ارباب حلقه‌ها: بازگشت پادشاه", "tt0114369": "هفت",
    "tt1345836": "شوالیه تاریکی برمی‌خیزد", "tt0167261": "ارباب حلقه‌ها: دو برج",
    "tt1853728": "جانگوی آزاد شده", "tt0172495": "گلادیاتور", "tt0993846": "گرگ وال‌استریت",
    "tt0361748": "پست فطرت‌های لعنتی", "tt0102926": "سکوت بره‌ها", "tt0372784": "بتمن آغاز می‌کند",
    "tt7286456": "جوکر", "tt4574334": "چیزهای عجیب", "tt0120815": "نجات سرباز رایان",
    "tt1130884": "جزیره شاتر", "tt0108052": "فهرست شیندلر", "tt0482571": "حیثیت",
    "tt0076759": "جنگ ستارگان: امیدی تازه", "tt0848228": "انتقام‌جویان",
    "tt0120689": "مسیر سبز", "tt0407887": "رفتگان", "tt0080684": "جنگ ستارگان: امپراتوری ضربه می‌زند",
    "tt0499549": "آواتار", "tt0071562": "پدرخوانده ۲", "tt0088763": "بازگشت به آینده",
    "tt4154796": "انتقام‌جویان: پایان بازی", "tt0209144": "یادگاری", "tt0120338": "تایتانیک",
    "tt0099685": "رفقای خوب", "tt2015381": "نگهبانان کهکشان", "tt4154756": "انتقام‌جویان: جنگ بی‌نهایت",
    "tt0120382": "نمایش ترومن", "tt0110413": "لئون: حرفه‌ای", "tt0325980": "دزدان دریایی کارائیب: نفرین مروارید سیاه",
    "tt0910970": "وال‌ای", "tt0266697": "بیل را بکش: بخش ۱", "tt0169547": "زیبایی آمریکایی",
    "tt0103064": "نابودگر ۲: روز داوری", "tt0120586": "تاریخ آمریکایی ایکس",
    "tt0110357": "شیرشاه", "tt1431045": "ددپول", "tt0434409": "وی مثل وندتا",
    "tt0114814": "مظنونین همیشگی", "tt1049413": "بالا", "tt0264464": "اگه تونستی منو بگیر",
    "tt0081505": "درخشش", "tt0371746": "مرد آهنی", "tt0086190": "جنگ ستارگان: بازگشت جدای",
    "tt1392190": "مکس دیوانه: جاده خشم", "tt0119217": "شکار ذهن",
    "tt0266543": "در جستجوی نمو", "tt1520211": "مردگان متحرک", "tt0108778": "دوستان",
    "tt0477348": "جایی برای پیرمردها نیست", "tt0338013": "درخشش ابدی یک ذهن پاک",
    "tt0107290": "پارک ژوراسیک", "tt0105236": "سگ‌های انباری", "tt0114709": "داستان اسباب‌بازی",
    "tt2267998": "دختر گمشده", "tt0112573": "شجاع‌دل",
}

SYNOPSIS_FA = {
    "tt0111161": "داستان اندی دوفرین، بانکداری که به اتهام قتل همسرش به زندان شاوشنک فرستاده می‌شود.",
    "tt0468569": "بتمن با جوکر، یک جنایتکار دیوانه که شهر گاتهام را به آشوب می‌کشد، رو به رو می‌شود.",
    "tt1375666": "دزدی ماهر که با نفوذ به رویاهای مردم، اسرار آنها را می‌دزدد.",
    "tt0816692": "گروهی از فضانوردان از طریق یک کرم‌چاله سفر می‌کنند تا خانه‌ای جدید برای بشریت بیابند.",
}

def parse_archive(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Split by <hr> to get individual entries
    entries = re.split(r'<hr\s*/?>', content)
    movies = []

    for entry in entries:
        entry = entry.strip()
        if not entry:
            continue

        # Extract title and number
        title_match = re.search(r'<h3>\s*(\d+)\.\s*(.*?)\s*</h3>', entry)
        if not title_match:
            continue

        num = title_match.group(1)
        title_raw = title_match.group(2).strip()

        # Extract year from title (e.g. "The Shawshank Redemption 1994")
        year_match = re.search(r'\b((?:19|20)\d{2})\s*$', title_raw)
        year = year_match.group(1) if year_match else ""
        title = title_raw[:year_match.start()].strip() if year_match else title_raw

        # IMDb code
        imdb_match = re.search(r'IMDb Code:\s*</b>\s*(tt\d+)', entry)
        imdb_code = imdb_match.group(1) if imdb_match else ""

        # Title type
        type_match = re.search(r'Title Type:\s*</b>\s*(\w+)', entry)
        title_type = type_match.group(1) if type_match else "movie"

        # Votes
        votes_match = re.search(r'IMDb Votes:\s*</b>\s*([\d,]+)', entry)
        votes = votes_match.group(1) if votes_match else "0"

        # Rating
        rating_match = re.search(r'IMDb Rates:\s*</b>\s*([\d.]+)', entry)
        rating = rating_match.group(1) if rating_match else "0"

        # Download links
        softsub_links = []
        dubbed_links = []

        # Split into SoftSub/Dubbed sections
        softsub_section = ""
        dubbed_section = ""

        softsub_marker = re.search(r'<b>SoftSub</b>', entry)
        dubbed_marker = re.search(r'<b>Dubbed</b>', entry)

        if softsub_marker and dubbed_marker:
            softsub_section = entry[softsub_marker.end():dubbed_marker.start()]
            dubbed_section = entry[dubbed_marker.end():]
        elif softsub_marker:
            softsub_section = entry[softsub_marker.end():]
        elif dubbed_marker:
            dubbed_section = entry[dubbed_marker.end():]

        def extract_links(section):
            links = []
            if title_type == "tvSeries":
                # For TV series, extract season info
                season_blocks = re.split(r'<p>season\s+(\d+)</p>', section)
                for i in range(1, len(season_blocks), 2):
                    season_num = season_blocks[i]
                    season_content = season_blocks[i + 1] if i + 1 < len(season_blocks) else ""
                    link_matches = re.findall(r'<a href="([^"]+)"[^>]*>([^<]+)</a>', season_content)
                    for url, quality in link_matches:
                        links.append({
                            "quality": quality.strip(),
                            "url": url.strip(),
                            "season": season_num,
                            "size": ""
                        })
            else:
                # For movies, extract individual links with sizes
                link_pattern = r'<a href="([^"]+)"[^>]*>([^<]+)</a>\s*/?\s*([\d.,]+\s*(?:GB|MB))?'
                link_matches = re.findall(link_pattern, section)
                for url, quality, size in link_matches:
                    links.append({
                        "quality": quality.strip(),
                        "url": url.strip(),
                        "size": size.strip() if size else ""
                    })
            return links

        softsub_links = extract_links(softsub_section)
        dubbed_links = extract_links(dubbed_section)

        # Get Persian title, genre, synopsis
        title_fa = TITLE_FA_MAP.get(imdb_code, title)
        genre = GENRE_MAP.get(imdb_code, "سریال" if title_type == "tvSeries" else "فیلم")
        synopsis = SYNOPSIS_FA.get(imdb_code, f"فیلم {title} ({year})" if year else f"فیلم {title}")

        movie = {
            "id": imdb_code,
            "num": int(num),
            "title": title,
            "titleFa": title_fa,
            "year": year,
            "type": title_type,
            "rating": rating,
            "votes": votes,
            "genre": genre,
            "synopsis": synopsis,
            "downloads": {
                "softsub": softsub_links,
                "dubbed": dubbed_links
            }
        }
        movies.append(movie)

    return movies

if __name__ == "__main__":
    movies = parse_archive("donyaye_serial_all_archive.html")
    with open("movies.json", "w", encoding="utf-8") as f:
        json.dump(movies, f, ensure_ascii=False, indent=None, separators=(',', ':'))
    print(f"Parsed {len(movies)} entries")
    print(f"Movies: {sum(1 for m in movies if m['type'] == 'movie')}")
    print(f"TV Series: {sum(1 for m in movies if m['type'] == 'tvSeries')}")
    print(f"movies.json size: {round(len(json.dumps(movies, ensure_ascii=False)) / 1024 / 1024, 2)} MB")
