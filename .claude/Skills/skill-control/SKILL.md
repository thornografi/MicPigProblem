---
name: skill-control
description: "Skill ve dokumantasyon tutarlilik kontrolu. Anahtar kelimeler: skill check, skill audit, AGENTS.md, CLAUDE.md, senkronizasyon, sync, routing, duplicate, hardcoded, guncellik, consistency"
---

# Skill Control - Tutarlilik ve Kalite Denetimi

Bu skill cagrildiginda asagidaki tum kontrolleri sirayla yap ve sonuclari raporla.

## 1. CLAUDE.md <-> AGENTS.md Senkronizasyon Kontrolu

### Neden Gerekli?
- `CLAUDE.md`: Claude Code tarafindan okunur (proje talimatlari)
- `AGENTS.md`: OpenAI Codex tarafindan okunur (ayni amac, farkli agent)
- Her iki dosya da aynı şeyleri içermeli

### Kontrol Adimlari
1. `CLAUDE.md` ve `AGENTS.md` dosyalarini oku
2. Skill Router tablolarini karsilastir:
   - Ayni skill'ler listelenmis mi?
   - Ayni dosya yollari gosterilmis mi?
   - Ayni anahtar kelimeler mevcut mu?
3. Farklilik varsa:
   - Hangisi guncel? (son degisiklik tarihine bak)
   - Senkronize et: `git log -1 --format="%ai" -- CLAUDE.md AGENTS.md`

### AGENTS.md Syntax Notlari (Codex Uyumluluk)
- Codex, AGENTS.md'yi koken calisma dizinine kadar hiyerarsik arar
- `AGENTS.override.md` varsa once onu okur
- Fallback dosyalar `config.toml`'da tanimlanabilir
- Dosya boyutu varsayilan 32KB ile sinirli
- Claude CLAUDE.md kullanir, Codex AGENTS.md - icerik ayni olmali

### Beklenen Cikti
```
SENKRONIZASYON KONTROLU
=======================
CLAUDE.md Skill Sayisi: X
AGENTS.md Skill Sayisi: Y
Eslesme: TAMAM / UYUMSUZ

Farklilklar:
- [varsa listele]
```

---

## 2. Skill Routing Problemleri Kontrolu

### Kontrol Edilecekler
1. **Overlapping Keywords**: Birden fazla skill ayni anahtar kelimeyi kullaniyor mu?
   - Ornek: Hem `micprobe-loopback` hem `web-audio-api` "AudioContext" iceriyorsa = PROBLEM

2. **Orphan Skills**: SKILL.md var ama router tablosunda yok mu?
   - `.claude/Skills/*/SKILL.md` dosyalarini listele
   - CLAUDE.md'deki tabloyla karsilastir

3. **Missing Skills**: Router'da listelenmis ama SKILL.md dosyasi yok mu?
   - Tablodaki dosya yollarini dogrula

### Beklenen Cikti
```
ROUTING ANALIZI
===============
Toplam Skill: X
Orphan: [varsa listele]
Missing: [varsa listele]
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
- `description` 250 karakteri gecmemeli (agent anlayabilmeli)
- SKILL.md toplam 250 satiri gecmemeli (performans)
- Cok uzunsa: ozetleme veya bolme onerisi
- CLAUDE.MD/AGENTS.md toplam 150 karakteri geçmemeli(proje kökü)

### 3.3 Tekrarlayan Bilgi Kontrolu
- Ayni bilgi birden fazla skill'de tekrarlaniyor mu?
- Ortak bilgiler ana CLAUDE.md'ye mi tasinmali?

### 3.4 Hardcoded vs Parametrik Bilgi
Sorunlu ornekler:
```markdown
# YANLIS - Hardcoded
Port: 8080
Buffer: 4096

# DOGRU - Referans
Port: Config.js'den SETTINGS.port
Buffer: SETTINGS.buffer.default
```

Kontrol et:
- Sabit port numaralari
- Sabit dosya yollari (C:\... gibi)
- Sabit URL'ler
- Config.js'de tanimli olmasi gereken degerler

### 3.5 Kod Guncelligi Kontrolu
Her skill icin:
1. SKILL.md'de referans edilen fonksiyon/modulleri bul
2. Gercek kod dosyasinda mevcut mu kontrol et
3. Gerçek kod dosyasında olup da skillerde olmayan önemli bir özellik var mı?

Ornek:
```
SKILL.md diyor ki:
  recorder.start(constraints, recordMode, timeslice)

Gercek kod (Recorder.js):
  async start(constraints, recordMode, timeslice, bufferSize) <- 4. parametre eklenmis!
```

### Beklenen Cikti
```
SKILL KALITE RAPORU
===================
skill-name:
  Frontmatter: OK / EKSIK
  Uzunluk: OK (X satir) / UZUN (X satir)
  Hardcoded: OK / UYARI [detay]
  Guncellik: OK / ESKI [detay]

[diger skill'ler...]
```

---

## 4. Cakisma Matrisi

Tum skill'lerin anahtar kelimelerini cikar ve cakisma matrisi olustur:

```
KEYWORD MATRIX
==============
Keyword          | Skills
-----------------|--------------------
AudioContext     | web-audio-api, micprobe-modules (!)
EventBus         | micprobe-modules
RTCPeerConnection| micprobe-loopback
...
```

`(!)` = Birden fazla skill ayni kelimeyi kullaniyor - routing problemi riski

---

## 5. Aksiyon Onerileri

Rapor sonunda:
```
ONERILEN AKSIYONLAR
===================
[ ] AGENTS.md ile CLAUDE.md senkronize edilmeli
[ ] skill-X: description kisaltilmali
[ ] skill-Y: Recorder.js API degismis, SKILL.md guncellenmeli
[ ] "AudioContext" keyword'u tek skill'e atanmali
```

---

## Hizli Calistirma

Bu skill cagrildiginda:
1. Tum dosyalari oku: CLAUDE.md, AGENTS.md, .claude/Skills/*/SKILL.md
2. Yukardaki 5 bolumu sirayla kontrol et
3. Sonuclari ozet rapor olarak sun
4. Kritik sorunlari vurgula (senkronizasyon, missing skills, stale docs)

## Ornek Cagri

Kullanici: "skill kontrolu yap" / "skill audit" / "dokumantasyon tutarliligini kontrol et"

Agent: Bu skill'i calistir ve yukaridaki formatta rapor olustur.
