const { parseAkademikKadroHtml, parseUnvanVeAd } = require('../services/akademikKadroService');

const ORNEK_HTML = `
<html><head><script>var x = "<h2>Prof. Dr. Sahte Kisi</h2> https://sahte.subu.edu.tr";</script></head><body>
<div class="team-block">
  <img src="/sites/bm.subu.edu.tr/files/gbb-uploads/A0550 - HAL&#304;T.jpg">
  <h2 class="team-name">Prof. Dr. Halit &Ouml;ztekin</h2>
  <div class="team-job">Bilgisayar Mühendisliği Bölüm Başkanı</div>
  <a href="https://halitoztekin.subu.edu.tr">https://halitoztekin.subu.edu.tr</a>
</div>
<div class="team-block">
  <h2>Doç. Dr. Caner Erden</h2>
  <p>Bilgisayar Mühendisliği Bölüm Başkan Yardımcısı</p>
  <a href="http://cerden.subu.edu.tr/">cerden.subu.edu.tr</a>
</div>
<div class="team-block">
  <h2>Dr. Öğr. Üyesi Muhammed Ali Nur Öz</h2>
  <a href="https://muhammedoz.subu.edu.tr">site</a>
</div>
<div class="team-block">
  <h2>Arş. Gör. İsmail Ergün</h2>
  <a href="mailto:ismail.ergun@subu.edu.tr">e-posta</a>
  <a href="https://ismailergun.subu.edu.tr">site</a>
</div>
<div class="team-block">
  <h2>Arş. Gör. Dr. Muhammed Yusuf Küçükkara</h2>
  <a href="https://www.subu.edu.tr">SUBÜ</a>
  <a href="https://muhammedkucukkara.subu.edu.tr">site</a>
</div>
<div class="team-block"><h2>Duyurular</h2><a href="https://bm.subu.edu.tr/duyurular">x</a></div>
<footer><a href="mailto:bilgi@subu.edu.tr">bilgi@subu.edu.tr</a></footer>
</body></html>`;

describe('Bölüm sitesi akademik kadro ayrıştırıcı', () => {
  const kadro = parseAkademikKadroHtml(ORNEK_HTML);

  test('kişi kartlarını unvan, ad, soyad ve e-posta olarak okur', () => {
    expect(kadro).toHaveLength(5);
    expect(kadro[0]).toEqual({
      unvan: 'Prof. Dr.', ad: 'Halit', soyad: 'Öztekin', eposta: 'halitoztekin@subu.edu.tr', gorev: 'Bölüm Başkanı'
    });
    expect(kadro[1].eposta).toBe('cerden@subu.edu.tr');
    expect(kadro[1].gorev).toBe('Bölüm Başkan Yardımcısı');
  });

  test('çok kelimeli adları ve uzun unvanları doğru böler', () => {
    expect(kadro[2]).toMatchObject({ unvan: 'Dr. Öğr. Üyesi', ad: 'Muhammed Ali Nur', soyad: 'Öz', gorev: null });
    expect(kadro[4]).toMatchObject({ unvan: 'Arş. Gör. Dr.', ad: 'Muhammed Yusuf', soyad: 'Küçükkara' });
  });

  test('açık mailto adresini tercih eder, kurumsal alt alanları atlar', () => {
    expect(kadro[3].eposta).toBe('ismail.ergun@subu.edu.tr');
    expect(kadro[4].eposta).toBe('muhammedkucukkara@subu.edu.tr');
  });

  test('script içeriğini ve unvansız başlıkları yok sayar', () => {
    expect(kadro.find((k) => k.soyad === 'Kisi')).toBeUndefined();
    expect(kadro.find((k) => k.eposta.startsWith('bilgi@'))).toBeUndefined();
  });

  test('parseUnvanVeAd', () => {
    expect(parseUnvanVeAd('Öğr. Gör. Dr. Ayşe Yılmaz')).toEqual({ unvan: 'Öğr. Gör. Dr.', ad: 'Ayşe', soyad: 'Yılmaz' });
    expect(parseUnvanVeAd('Tek')).toBeNull();
  });
});

describe('Gerçek bölüm sayfası (27.09.2026 kaydı)', () => {
  const fs = require('fs');
  const path = require('path');
  const { akademikKadro } = require('../data/bmAkademikKadro');
  const html = fs.readFileSync(path.join(__dirname, 'fixtures/bm-akademik-kadro-2026-09-27.html'), 'utf8');
  const kadro = parseAkademikKadroHtml(html);

  test('19 kişinin tamamını yedek listeyle aynı e-postalarla okur', () => {
    expect(kadro).toHaveLength(19);
    expect(kadro.map((k) => k.eposta).sort()).toEqual(akademikKadro.map((k) => k.eposta).sort());
  });

  test('görev bilgisini sadeleştirir', () => {
    expect(kadro.find((k) => k.soyad === 'Öztekin').gorev).toBe('Bölüm Başkanı');
    expect(kadro.find((k) => k.soyad === 'Uzun').gorev).toBeNull();
  });
});
