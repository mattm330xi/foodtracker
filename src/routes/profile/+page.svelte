<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { startRegistration } from '@simplewebauthn/browser';

  interface User { id: number; username: string; timezone: string; }
  interface Credential { id: number; credential_id: string; created_at: string; }
  interface Allergen { id: number; ingredient: string; created_at: string; }

  const TIMEZONES = [
    { value: 'America/New_York', label: 'Eastern Time (US)' },
    { value: 'America/Chicago', label: 'Central Time (US)' },
    { value: 'America/Denver', label: 'Mountain Time (US)' },
    { value: 'America/Los_Angeles', label: 'Pacific Time (US)' },
    { value: 'America/Anchorage', label: 'Alaska Time' },
    { value: 'Pacific/Honolulu', label: 'Hawaii Time' },
    { value: 'Europe/London', label: 'London (GMT/BST)' },
    { value: 'Europe/Paris', label: 'Paris (CET/CEST)' },
    { value: 'Europe/Berlin', label: 'Berlin (CET/CEST)' },
    { value: 'Asia/Tokyo', label: 'Tokyo (JST)' },
    { value: 'Asia/Shanghai', label: 'Shanghai (CST)' },
    { value: 'Asia/Kolkata', label: 'India (IST)' },
    { value: 'Australia/Sydney', label: 'Sydney (AEST/AEDT)' },
    { value: 'UTC', label: 'UTC' },
  ];

  let user: User | null = $state(null);
  let timezone = $state('America/New_York');
  let credentials: Credential[] = $state([]);
  let saving = $state(false);
  let passkeyError = $state('');
  let passkeySuccess = $state('');

  // Password
  let hasPassword = $state(false);
  let showPasswordForm = $state(false);
  let newPassword = $state('');
  let confirmNewPassword = $state('');
  let passwordError = $state('');
  let passwordSuccess = $state('');

  // Allergens
  let allergens: Allergen[] = $state([]);
  let newAllergen = $state('');
  let allergenError = $state('');
  let allergenSuccess = $state('');

  let highlightSection = $state('');

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    highlightSection = params.get('highlight') || '';

    const res = await fetch('/api/auth');
    const data = await res.json();
    if (!data.user) { goto('/login'); return; }
    user = data.user;
    timezone = data.user.timezone || 'America/New_York';
    loadCredentials();
    loadAllergens();
    loadAuthMethods();

    if (highlightSection === 'passkey') {
      setTimeout(() => {
        const el = document.getElementById('passkey-box');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  });

  async function loadCredentials() {
    const res = await fetch('/api/profile?action=list-credentials');
    const data = await res.json();
    credentials = data.credentials || [];
  }

  async function saveTimezone() {
    if (!user) return;
    saving = true;
    await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone })
    });
    saving = false;
  }

  async function addPasskey() {
    passkeyError = '';
    passkeySuccess = '';
    try {
      const startRes = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-passkey-start' }),
      });
      const startData = await startRes.json();
      if (startData.error) { passkeyError = startData.error; return; }

      const credential = await startRegistration(startData.options);

      const finishRes = await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add-passkey-finish', credential }),
      });
      const finishData = await finishRes.json();
      if (finishData.error) { passkeyError = finishData.error; return; }

      passkeySuccess = 'Passkey added';
      loadCredentials();
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') passkeyError = 'Cancelled';
      else passkeyError = e?.message || 'Failed';
    }
  }

  async function removePasskey(id: number) {
    await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove-passkey', credentialId: id }),
    });
    loadCredentials();
    loadAuthMethods();
  }

  async function loadAuthMethods() {
    const res = await fetch('/api/profile?action=check-auth-methods');
    const data = await res.json();
    hasPassword = data.hasPassword ?? false;
  }

  async function setPassword() {
    passwordError = '';
    passwordSuccess = '';
    if (newPassword !== confirmNewPassword) { passwordError = 'Passwords do not match'; return; }
    if (newPassword.length < 8) { passwordError = 'Password must be at least 8 characters'; return; }

    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set-password', password: newPassword }),
    });
    const data = await res.json();
    if (data.error) { passwordError = data.error; return; }

    passwordSuccess = hasPassword ? 'Password changed' : 'Password set';
    hasPassword = true;
    showPasswordForm = false;
    newPassword = '';
    confirmNewPassword = '';
  }

  async function logout() {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' })
    });
    goto('/login');
  }

  async function loadAllergens() {
    const res = await fetch('/api/allergens');
    const data = await res.json();
    allergens = data.allergens || [];
  }

  async function addAllergen() {
    allergenError = '';
    allergenSuccess = '';
    const input = newAllergen.trim();
    if (!input) return;

    const items = input.split(',').map(s => s.trim()).filter(Boolean);
    let added = 0;
    for (const item of items) {
      const res = await fetch('/api/allergens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ingredient: item })
      });
      if (res.ok) added++;
    }
    newAllergen = '';
    if (added > 0) {
      allergenSuccess = added === 1 ? 'Added' : `${added} ingredients added`;
    } else {
      allergenError = 'Already added';
    }
    loadAllergens();
  }

  async function removeAllergen(id: number) {
    await fetch('/api/allergens', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    loadAllergens();
  }
</script>

<svelte:head><title>Profile - Food Tracker</title></svelte:head>

<main>
  <header><h1><a href="/" class="back">←</a> Profile</h1></header>

  {#if user}
    <div class="section"><div class="username">{user.username}</div></div>

    <div class="section">
      <h2>Timezone</h2>
      <select bind:value={timezone} onchange={saveTimezone} class="select">
        {#each TIMEZONES as tz}<option value={tz.value}>{tz.label}</option>{/each}
      </select>
      {#if saving}<span class="saving">Saving...</span>{/if}
    </div>

    <div class="section">
      <h2>Sign-in Methods</h2>

      <div class="auth-method">
        <div class="auth-method-header">
          <strong>Password</strong>
          <small>{hasPassword ? 'Set' : 'Not set'}</small>
        </div>
        {#if showPasswordForm}
          {#if passwordError}<div class="error">{passwordError}</div>{/if}
          {#if passwordSuccess}<div class="success">{passwordSuccess}</div>{/if}
          <input
            bind:value={newPassword}
            type="password"
            placeholder={hasPassword ? 'New password' : 'Password'}
            autocomplete="new-password"
            class="auth-input"
          />
          <input
            bind:value={confirmNewPassword}
            type="password"
            placeholder="Confirm password"
            autocomplete="new-password"
            class="auth-input"
          />
          <div class="auth-actions">
            <button class="auth-save" onclick={setPassword}>Save</button>
            <button class="auth-cancel" onclick={() => { showPasswordForm = false; passwordError = ''; passwordSuccess = ''; newPassword = ''; confirmNewPassword = ''; }}>Cancel</button>
          </div>
        {:else}
          <button class="add-btn" onclick={() => { showPasswordForm = true; passwordError = ''; passwordSuccess = ''; }}>
            {hasPassword ? 'Change Password' : 'Set Password'}
          </button>
        {/if}
      </div>

      <div class="auth-method" id="passkey-box" class:highlighted={highlightSection === 'passkey'}>
        <div class="auth-method-header">
          <strong>Passkey / HW Token</strong>
          <small>{credentials.length} device{credentials.length !== 1 ? 's' : ''}</small>
        </div>
        {#if passkeyError}<div class="error">{passkeyError}</div>{/if}
        {#if passkeySuccess}<div class="success">{passkeySuccess}</div>{/if}
        {#each credentials as cred}
          <div class="cred-item">
            <div class="cred-info">
              <strong>Security Key</strong>
              <small>{new Date(cred.created_at).toLocaleDateString()}</small>
            </div>
            <button class="remove-btn" onclick={() => removePasskey(cred.id)}>Remove</button>
          </div>
        {/each}
        <button class="add-btn" onclick={addPasskey}>+ Add Device</button>
      </div>
    </div>

    <div class="section">
      <h2>Allergens</h2>
      <p class="section-desc">Ingredients you're allergic to. When scanning barcodes, we'll warn you if a product contains these.</p>
      {#if allergenError}<div class="error">{allergenError}</div>{/if}
      {#if allergenSuccess}<div class="success">{allergenSuccess}</div>{/if}
      <div class="allergen-input-row">
        <input
          bind:value={newAllergen}
          placeholder="e.g. garlic, onion, peanuts"
          class="allergen-input"
          onkeydown={(e) => { if (e.key === 'Enter') addAllergen(); }}
        />
        <button class="add-btn allergen-add" onclick={addAllergen}>Add</button>
      </div>
      {#if allergens.length > 0}
        <div class="allergen-list">
          {#each allergens as a (a.id)}
            <div class="allergen-item">
              <span class="allergen-pill">⚠️ {a.ingredient}</span>
              <button class="remove-btn" onclick={() => removeAllergen(a.id)}>✕</button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="no-allergens">No allergens added yet.</p>
      {/if}
    </div>

    <div class="section"><button class="logout" onclick={logout}>Sign Out</button></div>
  {/if}
</main>

<style>
  main { max-width: 480px; margin: 0 auto; padding: 16px; }
  h1 { margin: 0 0 16px; display: flex; align-items: center; gap: 8px; }
  h2 { margin: 0 0 8px; font-size: 14px; color: #666; font-weight: 600; }
  .back { text-decoration: none; color: #4CAF50; font-size: 20px; }
  .section { margin-bottom: 24px; padding: 16px; background: #fff; border-radius: 12px; border: 1px solid #eee; }
  .username { font-size: 20px; font-weight: 700; text-align: center; }
  .select {
    width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 8px;
    font-size: 14px; font-family: inherit; background: #fff;
  }
  .cred-item {
    display: flex; justify-content: space-between; align-items: center;
    padding: 10px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 6px;
  }
  .cred-info strong { display: block; font-size: 13px; }
  .cred-info small { color: #888; font-size: 11px; }
  .remove-btn {
    background: none; border: 1px solid #ffcdd2; color: #c00;
    padding: 4px 10px; border-radius: 6px; font-size: 12px; cursor: pointer;
    font-family: inherit;
  }
  .remove-btn:hover { background: #fff5f5; }
  .add-btn {
    width: 100%; padding: 10px; background: none; border: 1px dashed #ccc;
    color: #888; border-radius: 8px; font-size: 13px; cursor: pointer; margin-top: 6px;
    font-family: inherit;
  }
  .add-btn:hover { border-color: #4CAF50; color: #4CAF50; }
  .logout {
    width: 100%; padding: 10px; background: none; color: #c00;
    border: 1px solid #ffcdd2; border-radius: 8px; font-size: 14px;
    cursor: pointer; font-family: inherit;
  }
  .logout:hover { background: #fff5f5; }
  .error { background: #fff5f5; border: 1px solid #ffcdd2; color: #c00; padding: 8px; border-radius: 8px; font-size: 13px; margin-bottom: 8px; }
  .success { background: #e8f5e9; border: 1px solid #c8e6c9; color: #2e7d32; padding: 8px; border-radius: 8px; font-size: 13px; margin-bottom: 8px; }
  .saving { font-size: 12px; color: #888; margin-left: 8px; }
  .section-desc { font-size: 12px; color: #888; margin: 0 0 10px; }
  .allergen-input-row { display: flex; gap: 6px; margin-bottom: 10px; }
  .allergen-input { flex: 1; padding: 8px 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; font-family: inherit; }
  .allergen-add { width: auto; padding: 8px 14px; margin: 0; }
  .allergen-list { display: flex; flex-wrap: wrap; gap: 6px; }
  .allergen-item { display: flex; align-items: center; gap: 4px; }
  .allergen-pill {
    display: inline-flex; align-items: center; gap: 4px;
    background: #fff3e0; border: 1px solid #ffe0b2; color: #e65100;
    padding: 4px 10px; border-radius: 16px; font-size: 13px; font-weight: 500;
  }
  .no-allergens { font-size: 13px; color: #ccc; margin: 0; }
  .auth-method { padding: 10px; border: 1px solid #eee; border-radius: 8px; margin-bottom: 6px; transition: border-color 0.3s, box-shadow 0.3s; }
  .auth-method.highlighted { border-color: #4CAF50; box-shadow: 0 0 0 2px rgba(76, 175, 80, 0.25); }
  .auth-method-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .auth-method-header strong { font-size: 13px; }
  .auth-method-header small { color: #888; font-size: 11px; }
  .auth-input { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; font-family: inherit; margin-bottom: 6px; box-sizing: border-box; }
  .auth-actions { display: flex; gap: 6px; }
  .auth-save { flex: 1; padding: 8px; background: #4CAF50; color: #fff; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit; }
  .auth-save:hover { background: #388E3C; }
  .auth-cancel { flex: 1; padding: 8px; background: #f5f5f5; border: none; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit; }
</style>
