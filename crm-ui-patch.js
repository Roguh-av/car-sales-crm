/* CRM UI patch for Cloudflare-hosted build */
(() => {
  if (window.__crmCloudflareUiPatch) return;
  window.__crmCloudflareUiPatch = true;

  const style = document.createElement('style');
  style.textContent = `
    .crm-datetime.crm-picker-enhanced { padding:0; border:0; background:transparent; }
    .crm-picker-summary { width:100%; display:flex; align-items:center; justify-content:space-between; gap:10px; padding:10px 12px; border:1px solid var(--line); border-radius:9px; background:#0b1322; color:var(--text); text-align:left; }
    .crm-picker-summary:hover { border-color:#3b82f6; }
    .crm-picker-summary .crm-picker-value { font-weight:700; }
    .crm-picker-summary .crm-picker-icon { color:#93c5fd; font-size:16px; }
    .crm-datetime.crm-picker-enhanced:not(.crm-picker-open) .crm-picker-panel { display:none; }
    .crm-picker-panel { margin-top:8px; border:1px solid var(--line); border-radius:12px; background:#0b1322; padding:10px; }
  `;
  document.head.appendChild(style);

  const formatValue = picker => {
    const hidden = picker.querySelector('input[type="hidden"]');
    const value = hidden?.value || '';
    if (!value) return 'Choose date and time';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString([], {dateStyle:'medium', timeStyle:'short'});
  };

  const enhance = picker => {
    if (!picker || picker.dataset.clickPicker === '1') return;
    picker.dataset.clickPicker = '1';
    picker.classList.add('crm-picker-enhanced');

    const hidden = picker.querySelector('input[type="hidden"]');
    const panel = document.createElement('div');
    panel.className = 'crm-picker-panel';
    [...picker.children].forEach(child => {
      if (child !== hidden) panel.appendChild(child);
    });

    const summary = document.createElement('button');
    summary.type = 'button';
    summary.className = 'crm-picker-summary';
    summary.innerHTML = '<span class="crm-picker-value"></span><span class="crm-picker-icon">▾</span>';
    picker.appendChild(summary);
    picker.appendChild(panel);
    if (hidden) picker.insertBefore(hidden, summary);

    const refresh = () => {
      summary.querySelector('.crm-picker-value').textContent = formatValue(picker);
      summary.querySelector('.crm-picker-icon').textContent = picker.classList.contains('crm-picker-open') ? '▴' : '▾';
    };

    summary.onclick = e => {
      e.preventDefault();
      e.stopPropagation();
      picker.classList.toggle('crm-picker-open');
      refresh();
    };

    // After a date is chosen, keep the picker open long enough to choose a time.
    // The user can collapse it again with the summary row.
    panel.addEventListener('click', () => setTimeout(refresh, 0));
    panel.addEventListener('change', () => setTimeout(refresh, 0));
    refresh();
  };

  const scan = root => {
    if (root?.matches?.('.crm-datetime')) enhance(root);
    root?.querySelectorAll?.('.crm-datetime').forEach(enhance);
  };

  scan(document);
  new MutationObserver(mutations => {
    for (const m of mutations) {
      for (const node of m.addedNodes) if (node.nodeType === 1) scan(node);
    }
  }).observe(document.documentElement, {childList:true, subtree:true});

  // Calendar follow-up -> lead file.
  // The Leads page is already rendered in the DOM, even while hidden. Match the
  // calendar customer to a single active lead card and open that lead directly.
  // If there is no unique lead match, preserve the normal calendar-item editor.
  document.addEventListener('click', e => {
    const eventButton = e.target.closest?.('#calendar .event');
    if (!eventButton) return;
    const inline = eventButton.getAttribute('onclick') || '';
    if (!inline.includes('openCalendarFollowup(')) return;

    const customerName = eventButton.querySelector('b')?.textContent?.trim();
    if (!customerName) return;

    const matches = [...document.querySelectorAll('#pipeline .lead')].filter(card => {
      return card.querySelector('b')?.textContent?.trim() === customerName &&
             (card.getAttribute('onclick') || '').includes('openLeadFile(');
    });

    if (matches.length !== 1) return;

    e.preventDefault();
    e.stopImmediatePropagation();
    matches[0].click();
  }, true);
})();
