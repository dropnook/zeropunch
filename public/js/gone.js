// «Account deleted» (410 on an authenticated call): clear this device, unless the answer is a late one
// for an account another tab has already replaced on this device – then nothing is wiped, the tab only
// reloads. Kept apart from app.js so it can be tested without a browser.

/**
 * @param {{ stillOurs: () => Promise<boolean>, countOutbox: () => Promise<number>, wipe: () => Promise<void>,
 *   tellTabs: () => void, reload: () => void }} d
 * @returns {Promise<{ wiped: boolean, lost: number }>} lost = unsynced changes that went with the account
 */
export async function handleAccountGone(d) {
  if (!(await d.stillOurs().catch(() => false))) {
    d.reload();
    return { wiped: false, lost: 0 };
  }
  let lost = 0;
  try {
    lost = await d.countOutbox();
  } catch {
    lost = 0;
  }
  await d.wipe().catch(() => {});
  d.tellTabs();
  return { wiped: true, lost };
}
