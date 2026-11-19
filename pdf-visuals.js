function snapshotPdfImage(url) {
  return new Promise(resolve => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    const timeout = setTimeout(() => {
      finish(null);
      image.removeAttribute('src');
    }, 8000);

    function finish(snapshot) {
      clearTimeout(timeout);
      image.onload = image.onerror = null;
      resolve(snapshot);
    }

    image.onload = () => {
      try {
        const { naturalWidth, naturalHeight } = image;
        if (!naturalWidth || !naturalHeight) return finish(null);
        const scale = Math.min(1, 1600 / Math.max(naturalWidth, naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(naturalHeight * scale));
        const context = canvas.getContext('2d', { alpha: false });
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        // Canvas paints the first frame (or the default poster) of an animated image.
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        finish({ jpeg: canvas.toDataURL('image/jpeg', .88), ratio: canvas.width / canvas.height });
      } catch {
        finish(null);
      }
    };
    image.onerror = () => finish(null);
    image.src = url;
  });
}

async function appendVisualsPDF(doc, inputs) {
  const entries = visualEntries(inputs).flatMap(({ label, sources }) => sources.map((source, index) => ({
    source, caption: sources.length === 1 ? label : `${label} · ${index + 1}/${sources.length}`,
  })));
  const margin = 18;
  const gap = 8;
  const rowHeight = 102;

  for (let index = 0; index < entries.length; index += 2) {
    const row = entries.slice(index, index + 2);
    const snapshots = await Promise.all(row.map(async ({ source }) => {
      const image = await snapshotPdfImage(source.thumbnail);
      if (image || !source.fallback) return image;
      return snapshotPdfImage(source.fallback);
    }));

    if (index % 4 === 0) {
      doc.addPage('a4', 'portrait');
      doc.setTextColor('#415954');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(17);
      doc.text(index ? 'Visuels du test (suite)' : 'Visuels du test', margin, 24);
    }

    const availableWidth = doc.internal.pageSize.getWidth() - 2 * margin;
    const width = row.length === 1 ? availableWidth : (availableWidth - gap) / 2;
    const y = 43 + (index % 4 === 0 ? 0 : rowHeight + 14);
    row.forEach(({ source, caption }, column) => {
      const x = margin + column * (width + gap);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor('#415954');
      doc.text(caption, x, y - 4);
      doc.setDrawColor('#d6e1dd');
      doc.rect(x, y, width, rowHeight);

      const snapshot = snapshots[column];
      if (snapshot) {
        const height = Math.min(rowHeight - 8, (width - 8) / snapshot.ratio);
        const imageWidth = height * snapshot.ratio;
        doc.addImage(snapshot.jpeg, 'JPEG', x + (width - imageWidth) / 2, y + (rowHeight - height) / 2, imageWidth, height);
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setTextColor('#545d6b');
        doc.text('Aperçu non intégrable', x + 6, y + 14);
        doc.setTextColor('#415954');
        doc.textWithLink('Ouvrir le visuel', x + 6, y + 22, { url: source.url });
      }
    });
  }
}

async function downloadTestPDF(doc, inputs, filename, button) {
  const caption = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Préparation du PDF…';
  }
  try {
    await appendVisualsPDF(doc, inputs);
    doc.save(filename);
  } catch (error) {
    showError(`Impossible de générer le PDF · ${error.message}`);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = caption;
    }
  }
}
