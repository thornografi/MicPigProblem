---
name: skill-control
description: "Skill ve dokumantasyon tutarlilik kontrolu. Anahtar kelimeler: skill check, skill audit, AGENTS.md, CLAUDE.md, senkronizasyon, sync, routing, duplicate, hardcoded, guncellik, consistency"
---

Zorunlu:Bu satirlari okuyorsan konsola "skill-control SKILL.md okunuyor..." yaz ve bu .md yi okumaya devam et.

# Skill Control - Tutarlilik ve Kalite Denetimi

Bu skill cagrildiginda asagidaki tum kontrolleri sirayla yap ve sonuclari raporla.

---

## 1. CLAUDE.md <-> AGENTS.md Senkronizasyon Kontrolu

### Neden Gerekli?
- `CLAUDE.md`: Claude Code tarafindan okunur
- `AGENTS.md`: OpenAI Codex tarafindan okunur
- Her iki dosya da ayni skill router tablosunu icermeli

### Kontrol Adimlari
1. `CLAUDE.md` ve `AGENTS.md` dosyalarini oku
2. Skill Router tablolarini karsilastir (skill sayisi, dosya yollari, anahtar kelimeler)
3. Farklilik varsa: `git log -1 --format="%ai" -- CLAUDE.md AGENTS.md` ile hangisi guncel bul

### Beklenen Cikti
```
SENKRONIZASYON KONTROLU
=======================
CLAUDE.md Skill Sayisi: X
AGENTS.md Skill Sayisi: Y
Eslesme: TAMAM / UYUMSUZ
Farklilklar: [varsa listele]
```

---

## 2. Skill Routing ve Cakisma Kontrolu

### Kontrol Edilecekler

| Kontrol | Aciklama | Ornek |
|---------|----------|-------|
| **Overlapping Keywords** | Ayni keyword birden fazla skill'de mi? | "AudioContext" → web-audio-api, micprobe-modules (!) |
| **Orphan Skills** | SKILL.md var ama router'da yok mu? | `.claude/Skills/*/SKILL.md` listele, tabloyla karsilastir |
| **Missing Skills** | Router'da var ama SKILL.md yok mu? | Tablodaki yollari dogrula |

### Beklenen Cikti
```
ROUTING ANALIZI
===============
Toplam Skill: X
Orphan: [listele]
Missing: [listele]
Overlapping Keywords:
- "keyword" -> skill1, skill2 (CAKISMA!)
```

---

## 3. Skill Icerigi Kalite Kontrolu

Her `.claude/Skills/*/SKILL.md` dosyasi icin:

### 3.1 Frontmatter Kontrolu
```yaml
---
name: skill-adi        # ZORUNLU
description: "..."     # ZORUNLU, anahtar kelimeler icermeli
---
```

### 3.2 Uzunluk Kontrolu
| Dosya | Limit | Asim Aksiyonu |
|-------|-------|---------------|
| SKILL.md description | 250 karakter | Kisalt |
| SKILL.md toplam | 250 satir | Ozetle veya bol |
| CLAUDE.md / AGENTS.md | 150 satir | Skill'lere tasi |

### 3.3 Hardcoded Deger Kontrolu
Sorunlu: Sabit port, dosya yolu (C:\...), URL, config degerleri
Dogru: Config referansi (`Config.XXX`, `SETTINGS.xxx`)

### 3.4 Staleness (Guncellik) Kontrolu

```
SORU: Skill'in referans ettigi kod degisti mi?
      |
      +-- EVET → Skill STALE, guncellenmeli
      |
      +-- HAYIR → OK
```

**Kontrol Yontemi:**
1. SKILL.md'de referans edilen fonksiyon/modulleri bul
2. Gercek kodda mevcut mu, signature degisti mi kontrol et

### Beklenen Cikti
```
SKILL KALITE RAPORU
===================
skill-name:
  Frontmatter: OK / EKSIK
  Uzunluk: OK (X satir) / UZUN
  Hardcoded: OK / UYARI [detay]
  Staleness: OK / STALE [detay]
```

---

## 4. Bulgu Duzeltme Kurali Kontrolu

> Yeni eklenen "Bulgu Duzeltme Sonrasi Zorunlu Analiz" kurali CLAUDE.md ve AGENTS.md'de var mi?

### Kontrol Edilecekler

| Kural | CLAUDE.md'de Var mi? | AGENTS.md'de Var mi? |
|-------|---------------------|---------------------|
| Varyant Analizi | ? | ? |
| Etki Analizi | ? | ? |
| DRY Ihlali Analizi | ? | ? |
| Checklist | ? | ? |

Eksikse: Ilgili dosyaya ekle.

---

## 5. Aksiyon Onerileri

Rapor sonunda:
```
ONERILEN AKSIYONLAR
===================
[ ] AGENTS.md ile CLAUDE.md senkronize edilmeli
[ ] skill-X: description kisaltilmali (280 -> 250 karakter)
[ ] skill-Y: Recorder.js API degismis, SKILL.md guncellenmeli
[ ] "AudioContext" keyword'u tek skill'e atanmali
[ ] CLAUDE.md'ye "Bulgu Duzeltme" kurali eklenmeli
```

---

## Hizli Calistirma

Bu skill cagrildiginda:
1. Tum dosyalari oku: CLAUDE.md, AGENTS.md, .claude/Skills/*/SKILL.md
2. Yukardaki 5 bolumu sirayla kontrol et
3. Sonuclari ozet rapor olarak sun
4. Kritik sorunlari vurgula

## Ornek Cagri

Kullanici: "skill kontrolu yap" / "skill audit" / "dokumantasyon tutarliligini kontrol et"

Agent: Bu skill'i calistir ve yukaridaki formatta rapor olustur.
