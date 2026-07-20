<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { startRegistration } from '@simplewebauthn/browser';

  interface User { id: number; username: string; timezone: string; }
  interface Credential { id: number; credential_id: string; created_at: string; }

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

  onMount(async () => {
    const res = await fetch('/api/auth');
    const data = await res.json();
    if (!data.user) { goto('/login'); return; }
    user = data.user;
    timezone = data.user.timezone || 'America/New_York';
    loadCredentials();
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
  }

  async function logout() {
    await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'logout' })
    });
    goto('/login');
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
      <h2>Passkeys</h2>
      {#if passkeyError}<div class="error">{passkeyError}</div>{/if}
      {#if passkeySuccess}<div class="success">{passkeySuccess}</div>{/if}
      {#each credentials as cred}
        <div class="cred-item">
          <div class="cred-info">
            <strong>Passkey</strong>
            <small>{new Date(cred.created_at).toLocaleDateString()}</small>
          </div>
          <button class="remove-btn" onclick={() => removePasskey(cred.id)}>Remove</button>
        </div>
      {/each}
      <button class="add-btn" onclick={addPasskey}>+ Add Passkey</button>
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
</style>
