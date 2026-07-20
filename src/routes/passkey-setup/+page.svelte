<script lang="ts">
  let username = $state('mattm330xi@gmail.com');
  let loading = $state(false);
  let error = $state('');
  let success = $state('');
  let log = $state('');

  function addLog(msg: string) { log += msg + '\n'; }

  function bufToBase64url(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64urlToBuf(str: string): ArrayBuffer {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  async function setup() {
    error = '';
    success = '';
    log = '';
    loading = true;

    try {
      addLog('Fetching options...');
      const optRes = await fetch(`/api/passkey-setup?user=${encodeURIComponent(username)}`);
      const optData = await optRes.json();
      if (optData.error) { error = optData.error; loading = false; return; }
      addLog('Got options, prompting device...');

      const challengeBuf = base64urlToBuf(optData.options.challenge);
      const userIdBuf = base64urlToBuf(optData.options.user.id);

      const createOptions: CredentialCreationOptions = {
        publicKey: {
          rp: optData.options.rp,
          user: {
            id: userIdBuf,
            name: optData.options.user.name,
            displayName: optData.options.user.displayName,
          },
          challenge: challengeBuf,
          pubKeyCredParams: optData.options.pubKeyCredParams,
          authenticatorSelection: optData.options.authenticatorSelection,
          timeout: optData.options.timeout,
          attestation: optData.options.attestation,
        }
      };

      const credential = await navigator.credentials.create(createOptions) as PublicKeyCredential;
      addLog('Got credential from browser. Sending to server...');

      const raw = credential.rawId;
      const response = credential.response as AuthenticatorAttestationResponse;

      const body = {
        id: credential.id,
        rawId: bufToBase64url(raw),
        type: credential.type,
        response: {
          clientDataJSON: bufToBase64url(response.clientDataJSON),
          attestationObject: bufToBase64url(response.attestationObject),
          getAuthenticatorData: () => bufToBase64url(response.getAuthenticatorData()),
          getPublicKey: () => response.getPublicKey() ? bufToBase64url(response.getPublicKey()!) : null,
          getPublicKeyAlgorithm: () => response.getPublicKeyAlgorithm(),
          getTransports: () => response.getTransports(),
        },
      };

      addLog('Verifying on server...');
      const finishRes = await fetch('/api/passkey-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credential: body,
          challenge: optData.options.challenge,
          userId: optData._userId,
        }),
      });
      const finishData = await finishRes.json();
      addLog('Server response: ' + JSON.stringify(finishData));

      if (finishData.error) {
        error = finishData.error;
      } else {
        success = 'Passkey registered! Go sign in.';
      }
    } catch (e: any) {
      error = e?.message || String(e);
      addLog('Error: ' + (e?.stack || e));
    }
    loading = false;
  }
</script>

<svelte:head><title>Passkey Setup - Temporary</title></svelte:head>

<main>
  <div class="card">
    <h1>Temporary Passkey Setup</h1>
    <p class="sub">One-time setup for accounts created before passkeys were enabled.</p>
    {#if success}
      <div class="success">{success}</div>
      <a href="/" class="link">Go to Food Tracker →</a>
    {:else}
      {#if error}<div class="error">{error}</div>{/if}
      <input bind:value={username} placeholder="Username" class="input" />
      <button class="btn" onclick={setup} disabled={loading || !username.trim()}>
        {loading ? 'Working...' : 'Register Passkey'}
      </button>
    {/if}
    {#if log}
      <pre class="log">{log}</pre>
    {/if}
  </div>
</main>

<style>
  main { display: flex; align-items: center; justify-content: center; min-height: 100vh; background: #f5f5f5; }
  .card { background: #fff; border-radius: 16px; padding: 32px; width: 380px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); text-align: center; }
  h1 { margin: 0 0 4px; font-size: 18px; }
  .sub { color: #888; font-size: 13px; margin: 0 0 16px; }
  .error { background: #fff5f5; border: 1px solid #ffcdd2; color: #c00; padding: 8px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; text-align: left; }
  .success { background: #e8f5e9; border: 1px solid #c8e6c9; color: #2e7d32; padding: 10px; border-radius: 8px; font-size: 14px; margin-bottom: 12px; }
  .input { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; margin-bottom: 12px; box-sizing: border-box; font-family: inherit; }
  .btn { width: 100%; padding: 10px; background: #4CAF50; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .link { display: block; margin-top: 12px; color: #4CAF50; text-decoration: none; font-size: 14px; }
  .log { text-align: left; font-size: 11px; color: #888; margin-top: 16px; background: #f5f5f5; padding: 8px; border-radius: 6px; white-space: pre-wrap; word-break: break-all; max-height: 200px; overflow-y: auto; }
</style>
