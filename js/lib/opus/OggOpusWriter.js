/**
 * OggOpusWriter - Opus frame'lerini Ogg container'a yazan utility
 *
 * Ogg Opus format:
 * 1. ID Header Page (OpusHead)
 * 2. Comment Header Page (OpusTags)
 * 3. Audio Data Pages
 *
 * Referans: RFC 7845 (Ogg Encapsulation for the Opus Audio Codec)
 */

const OGG_CAPTURE_PATTERN = 0x5367674F; // "OggS" big-endian
const OPUS_HEAD_SIGNATURE = [0x4F, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64]; // "OpusHead"
const OPUS_TAGS_SIGNATURE = [0x4F, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73]; // "OpusTags"
const VENDOR_STRING = 'MicProbe WASM Opus';

export class OggOpusWriter {
  /**
   * @param {number} sampleRate - Input sample rate (will be resampled to 48kHz internally)
   * @param {number} channels - Channel count (1 = mono, 2 = stereo)
   */
  constructor(sampleRate = 48000, channels = 1) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.serialNumber = Math.floor(Math.random() * 0xFFFFFFFF);
    this.pageSequence = 0;
    this.granulePosition = 0n; // BigInt for 64-bit precision
    this.pages = [];

    // Pre-skip hesapla (encoder delay)
    // Opus encoder tipik olarak 3.75ms pre-skip kullanir (48kHz'de 312 sample)
    // Ama guvenli deger 120 sample (RFC tavsiyesi)
    this.preSkip = 312;

    // Header page'leri yaz
    this._writeIdHeader();
    this._writeCommentHeader();
  }

  /**
   * OpusHead header page yaz (ID Header)
   * @private
   */
  _writeIdHeader() {
    // OpusHead structure (19 bytes)
    const header = new Uint8Array(19);
    let offset = 0;

    // Signature "OpusHead"
    header.set(OPUS_HEAD_SIGNATURE, offset);
    offset += 8;

    // Version (1 byte) - must be 1
    header[offset++] = 1;

    // Channel count (1 byte)
    header[offset++] = this.channels;

    // Pre-skip (2 bytes, little-endian)
    header[offset++] = this.preSkip & 0xFF;
    header[offset++] = (this.preSkip >> 8) & 0xFF;

    // Input sample rate (4 bytes, little-endian)
    header[offset++] = this.sampleRate & 0xFF;
    header[offset++] = (this.sampleRate >> 8) & 0xFF;
    header[offset++] = (this.sampleRate >> 16) & 0xFF;
    header[offset++] = (this.sampleRate >> 24) & 0xFF;

    // Output gain (2 bytes, little-endian) - 0 = no gain
    header[offset++] = 0;
    header[offset++] = 0;

    // Channel mapping family (1 byte) - 0 = mono/stereo
    header[offset++] = 0;

    // Ogg page olustur (BOS = Beginning Of Stream)
    const page = this._createPage([header], 0n, true, false);
    this.pages.push(page);
  }

  /**
   * OpusTags header page yaz (Comment Header)
   * @private
   */
  _writeCommentHeader() {
    // OpusTags structure
    const vendorBytes = new TextEncoder().encode(VENDOR_STRING);
    const tagsSize = 8 + 4 + vendorBytes.length + 4; // signature + vendor_length + vendor + user_comment_list_length

    const tags = new Uint8Array(tagsSize);
    let offset = 0;

    // Signature "OpusTags"
    tags.set(OPUS_TAGS_SIGNATURE, offset);
    offset += 8;

    // Vendor string length (4 bytes, little-endian)
    tags[offset++] = vendorBytes.length & 0xFF;
    tags[offset++] = (vendorBytes.length >> 8) & 0xFF;
    tags[offset++] = (vendorBytes.length >> 16) & 0xFF;
    tags[offset++] = (vendorBytes.length >> 24) & 0xFF;

    // Vendor string
    tags.set(vendorBytes, offset);
    offset += vendorBytes.length;

    // User comment list length (0 comments)
    tags[offset++] = 0;
    tags[offset++] = 0;
    tags[offset++] = 0;
    tags[offset++] = 0;

    // Ogg page olustur
    const page = this._createPage([tags], 0n, false, false);
    this.pages.push(page);
  }

  /**
   * Opus frame yaz
   * @param {Uint8Array} opusFrame - Encoded Opus frame data
   * @param {number} samplesInFrame - Frame'deki sample sayisi (genellikle 960 = 20ms @ 48kHz)
   */
  writeFrame(opusFrame, samplesInFrame = 960) {
    this.granulePosition += BigInt(samplesInFrame);

    // Frame'i bir Ogg page'e yaz
    // Not: Gercek implementasyonda birden fazla frame tek page'e sigabilir
    // Simdilik basitlik icin her frame ayri page
    const page = this._createPage([opusFrame], this.granulePosition, false, false);
    this.pages.push(page);
  }

  /**
   * Birden fazla Opus frame yaz (batch)
   * @param {Uint8Array[]} opusFrames - Encoded Opus frames
   * @param {number} samplesPerFrame - Her frame'deki sample sayisi
   */
  writeFrames(opusFrames, samplesPerFrame = 960) {
    for (const frame of opusFrames) {
      this.writeFrame(frame, samplesPerFrame);
    }
  }

  /**
   * Son page'i yaz ve Blob dondur
   * @returns {Blob} - .ogg formatinda Blob
   */
  finish() {
    // Son page'i EOS (End Of Stream) olarak isaretle
    if (this.pages.length > 2) { // Header'lar haric
      // Son data page'ini EOS yap
      // Aslinda son page zaten yazilmis, bu noktada sadece blob olusturuyoruz
    }

    // Son page'i EOS ile yeniden olustur
    // Not: Eger hic data yazilmamissa, bos bir EOS page ekle
    if (this.pages.length === 2) {
      // Sadece header'lar var, bos audio
      const emptyPage = this._createPage([], this.granulePosition, false, true);
      this.pages.push(emptyPage);
    } else {
      // Son page'i EOS olarak yeniden yaz
      const lastPageData = this.pages.pop();
      // CRC'yi yeniden hesapla EOS flag ile
      const lastPageWithEos = this._recreatePageWithEos(lastPageData);
      this.pages.push(lastPageWithEos);
    }

    // Tum page'leri birlestir
    const totalSize = this.pages.reduce((sum, p) => sum + p.length, 0);
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const page of this.pages) {
      result.set(page, offset);
      offset += page.length;
    }

    return new Blob([result], { type: 'audio/ogg; codecs=opus' });
  }

  /**
   * Ogg page olustur
   * @private
   * @param {Uint8Array[]} segments - Page segment'leri
   * @param {BigInt} granulePos - Granule position
   * @param {boolean} bos - Beginning of stream
   * @param {boolean} eos - End of stream
   * @returns {Uint8Array}
   */
  _createPage(segments, granulePos, bos = false, eos = false) {
    // Segment tablosu olustur
    const segmentTable = [];
    const segmentData = [];

    for (const segment of segments) {
      let remaining = segment.length;
      let offset = 0;

      while (remaining > 0) {
        const lacingValue = Math.min(remaining, 255);
        segmentTable.push(lacingValue);
        segmentData.push(segment.slice(offset, offset + lacingValue));
        remaining -= lacingValue;
        offset += lacingValue;

        // Eger tam 255 ise, 0 byte ile bitir (continuation)
        if (lacingValue === 255 && remaining === 0) {
          segmentTable.push(0);
        }
      }
    }

    // Header (27 bytes) + segment table + data
    const headerSize = 27 + segmentTable.length;
    const dataSize = segmentData.reduce((sum, s) => sum + s.length, 0);
    const page = new Uint8Array(headerSize + dataSize);

    let offset = 0;

    // Capture pattern "OggS"
    page[offset++] = 0x4F; // O
    page[offset++] = 0x67; // g
    page[offset++] = 0x67; // g
    page[offset++] = 0x53; // S

    // Version (1 byte) - always 0
    page[offset++] = 0;

    // Header type flag
    let headerType = 0;
    if (bos) headerType |= 0x02;
    if (eos) headerType |= 0x04;
    page[offset++] = headerType;

    // Granule position (8 bytes, little-endian)
    const granule = BigInt(granulePos);
    for (let i = 0; i < 8; i++) {
      page[offset++] = Number((granule >> BigInt(i * 8)) & 0xFFn);
    }

    // Serial number (4 bytes, little-endian)
    page[offset++] = this.serialNumber & 0xFF;
    page[offset++] = (this.serialNumber >> 8) & 0xFF;
    page[offset++] = (this.serialNumber >> 16) & 0xFF;
    page[offset++] = (this.serialNumber >> 24) & 0xFF;

    // Page sequence number (4 bytes, little-endian)
    page[offset++] = this.pageSequence & 0xFF;
    page[offset++] = (this.pageSequence >> 8) & 0xFF;
    page[offset++] = (this.pageSequence >> 16) & 0xFF;
    page[offset++] = (this.pageSequence >> 24) & 0xFF;
    this.pageSequence++;

    // CRC checksum placeholder (4 bytes) - hesaplanacak
    const crcOffset = offset;
    page[offset++] = 0;
    page[offset++] = 0;
    page[offset++] = 0;
    page[offset++] = 0;

    // Number of page segments (1 byte)
    page[offset++] = segmentTable.length;

    // Segment table
    for (const lacing of segmentTable) {
      page[offset++] = lacing;
    }

    // Segment data
    for (const segment of segmentData) {
      page.set(segment, offset);
      offset += segment.length;
    }

    // CRC32 hesapla ve yaz
    const crc = this._calculateCRC32(page);
    page[crcOffset] = crc & 0xFF;
    page[crcOffset + 1] = (crc >> 8) & 0xFF;
    page[crcOffset + 2] = (crc >> 16) & 0xFF;
    page[crcOffset + 3] = (crc >> 24) & 0xFF;

    return page;
  }

  /**
   * Son page'i EOS flag ile yeniden olustur
   * @private
   */
  _recreatePageWithEos(pageData) {
    // Header type byte'i guncelle (offset 5)
    const newPage = new Uint8Array(pageData);
    newPage[5] |= 0x04; // EOS flag ekle

    // CRC yeniden hesapla (offset 22-25)
    newPage[22] = 0;
    newPage[23] = 0;
    newPage[24] = 0;
    newPage[25] = 0;

    const crc = this._calculateCRC32(newPage);
    newPage[22] = crc & 0xFF;
    newPage[23] = (crc >> 8) & 0xFF;
    newPage[24] = (crc >> 16) & 0xFF;
    newPage[25] = (crc >> 24) & 0xFF;

    return newPage;
  }

  /**
   * Ogg CRC32 hesapla
   * @private
   * @param {Uint8Array} data
   * @returns {number}
   */
  _calculateCRC32(data) {
    // Ogg CRC32 lookup table (polynomial: 0x04c11db7)
    const crcTable = this._getCrcTable();

    let crc = 0;
    for (let i = 0; i < data.length; i++) {
      crc = (crc << 8) ^ crcTable[((crc >>> 24) & 0xFF) ^ data[i]];
    }

    return crc >>> 0; // Unsigned
  }

  /**
   * CRC lookup table lazy initialization
   * @private
   */
  _getCrcTable() {
    if (!OggOpusWriter._crcTable) {
      const table = new Uint32Array(256);
      const polynomial = 0x04c11db7;

      for (let i = 0; i < 256; i++) {
        let r = i << 24;
        for (let j = 0; j < 8; j++) {
          if (r & 0x80000000) {
            r = (r << 1) ^ polynomial;
          } else {
            r <<= 1;
          }
        }
        table[i] = r >>> 0;
      }

      OggOpusWriter._crcTable = table;
    }
    return OggOpusWriter._crcTable;
  }
}

// Static CRC table
OggOpusWriter._crcTable = null;

export default OggOpusWriter;
