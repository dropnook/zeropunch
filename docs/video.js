// The video tile in the NFC card: opens the film large in a dialog and plays it. Without JavaScript the
// tile is a plain link to the video file. The address .../#nfc-video (the app's guide links there) opens it too.
const tile = document.querySelector('a[data-video]');
const dialog = tile && document.getElementById(tile.dataset.video);
const video = dialog?.querySelector('video');

if (dialog && video && typeof dialog.showModal === 'function') {
  const open = () => {
    if (dialog.open) return;
    dialog.showModal();
    video.currentTime = 0;
    video.play().catch(() => {
      /* the controls stay; the visitor starts it */
    });
  };
  tile.addEventListener('click', (e) => {
    e.preventDefault();
    open();
  });
  dialog.addEventListener('close', () => video.pause());
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close(); // a click on the backdrop
  });
  const fromHash = () => {
    if (location.hash === '#' + tile.id) {
      tile.scrollIntoView({ block: 'center' });
      open();
    }
  };
  window.addEventListener('hashchange', fromHash);
  fromHash();
}
