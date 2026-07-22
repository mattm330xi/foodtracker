<script lang="ts">
  import { goto } from '$app/navigation';

  let mode: 'login' | 'register' = $state('login');
  let authMethod: 'passkey' | 'password' = $state('passkey');
  let username = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let loading = $state(false);
  let error = $state('');
  let step: 'idle' | 'working' = $state('idle');
  let confirmMessage = $state('');
  let pendingPassword = $state('');

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

  // ─── Passkey registration ─────────────────────────────────

  async function handleRegister() {
    error = '';
    loading = true;
    step = 'working';

    try {
      const startRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register-start', username }),
      });
      const startData = await startRes.json();
      if (startData.error) { error = startData.error; loading = false; step = 'idle'; return; }

      const opts = startData.options;
      const createOptions: CredentialCreationOptions = {
        publicKey: {
          rp: opts.rp,
          user: {
            id: base64urlToBuf(opts.user.id),
            name: opts.user.name,
            displayName: opts.user.displayName,
          },
          challenge: base64urlToBuf(opts.challenge),
          pubKeyCredParams: opts.pubKeyCredParams,
          authenticatorSelection: opts.authenticatorSelection,
          timeout: opts.timeout,
          attestation: opts.attestation,
        }
      };

      const credential = await navigator.credentials.create(createOptions) as PublicKeyCredential;
      const raw = credential.rawId;
      const response = credential.response as AuthenticatorAttestationResponse;

      const body = {
        id: credential.id,
        rawId: bufToBase64url(raw),
        type: credential.type,
        response: {
          clientDataJSON: bufToBase64url(response.clientDataJSON),
          attestationObject: bufToBase64url(response.attestationObject),
          transports: response.getTransports?.() ?? [],
        },
      };

      const finishRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register-finish', credential: body }),
      });
      const finishData = await finishRes.json();
      if (finishData.error) { error = finishData.error; loading = false; step = 'idle'; return; }

      goto('/');
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Sign-in was cancelled' : e?.message || 'Failed';
      loading = false;
      step = 'idle';
    }
  }

  // ─── Passkey login ────────────────────────────────────────

  async function handleLogin() {
    error = '';
    confirmMessage = '';
    loading = true;
    step = 'working';

    try {
      const startRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login-start', username }),
      });
      const startData = await startRes.json();

      if (startData.confirmWithPassword) {
        loading = false;
        step = 'idle';
        authMethod = 'password';
        confirmMessage = 'Enter your password to add Face ID or Touch ID to this account.';
        return;
      }

      if (startData.error) { error = startData.error; loading = false; step = 'idle'; return; }

      const opts = startData.options;
      const getOptions: CredentialRequestOptions = {
        publicKey: {
          challenge: base64urlToBuf(opts.challenge),
          rpId: opts.rpId,
          allowCredentials: opts.allowCredentials?.map((c: any) => ({
            id: base64urlToBuf(c.id),
            type: 'public-key' as PublicKeyCredentialType,
            transports: c.transports as AuthenticatorTransport[],
          })),
          userVerification: opts.userVerification,
          timeout: opts.timeout,
        }
      };

      const credential = await navigator.credentials.get(getOptions) as PublicKeyCredential;
      const response = credential.response as AuthenticatorAssertionResponse;

      const body = {
        id: credential.id,
        rawId: bufToBase64url(credential.rawId),
        type: credential.type,
        response: {
          clientDataJSON: bufToBase64url(response.clientDataJSON),
          authenticatorData: bufToBase64url(response.authenticatorData),
          signature: bufToBase64url(response.signature),
          userHandle: response.userHandle ? bufToBase64url(response.userHandle) : null,
        },
      };

      const finishRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login-finish', credential: body, userId: startData.userId }),
      });
      const finishData = await finishRes.json();
      if (finishData.error) { error = finishData.error; loading = false; step = 'idle'; return; }

      goto('/');
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Sign-in was cancelled' : e?.message || 'Failed';
      loading = false;
      step = 'idle';
    }
  }

  // ─── Password registration ────────────────────────────────

  async function handleRegisterPassword() {
    error = '';
    if (password !== confirmPassword) { error = 'Passwords do not match'; return; }
    if (password.length < 8) { error = 'Password must be at least 8 characters'; return; }
    loading = true;
    step = 'working';

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'register-password', username, password }),
      });
      const data = await res.json();
      if (data.error) { error = data.error; loading = false; step = 'idle'; return; }
      goto('/');
    } catch (e: any) {
      error = e?.message || 'Failed';
      loading = false;
      step = 'idle';
    }
  }

  // ─── Password login (+ cross-method flow) ─────────────────

  async function handleLoginPassword() {
    error = '';
    confirmMessage = '';
    loading = true;
    step = 'working';

    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login-password', username, password }),
      });
      const data = await res.json();

      if (data.confirmWithPasskey) {
        pendingPassword = password;
        password = '';
        loading = true;
        step = 'working';
        confirmMessage = 'Use your Face ID or Touch ID to add password access.';
        await finishPasskeyAfterPasswordConfirm();
        return;
      }

      if (data.error) { error = data.error; loading = false; step = 'idle'; return; }
      if (data.needsPasskey) {
        goto('/profile?highlight=passkey');
        return;
      }
      goto('/');
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Sign-in was cancelled' : e?.message || 'Failed';
      loading = false;
      step = 'idle';
    }
  }

  // ─── Cross-method: passkey confirm → set password ─────────

  async function finishPasskeyAfterPasswordConfirm() {
    try {
      const startRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'login-start', username }),
      });
      const startData = await startRes.json();
      if (startData.error) { error = startData.error; loading = false; step = 'idle'; pendingPassword = ''; return; }

      const opts = startData.options;
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64urlToBuf(opts.challenge),
          rpId: opts.rpId,
          allowCredentials: opts.allowCredentials?.map((c: any) => ({
            id: base64urlToBuf(c.id),
            type: 'public-key' as PublicKeyCredentialType,
            transports: c.transports as AuthenticatorTransport[],
          })),
          userVerification: opts.userVerification,
          timeout: opts.timeout,
        }
      }) as PublicKeyCredential;
      const response = credential.response as AuthenticatorAssertionResponse;

      const finishRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'login-finish',
          credential: {
            id: credential.id,
            rawId: bufToBase64url(credential.rawId),
            type: credential.type,
            response: {
              clientDataJSON: bufToBase64url(response.clientDataJSON),
              authenticatorData: bufToBase64url(response.authenticatorData),
              signature: bufToBase64url(response.signature),
              userHandle: response.userHandle ? bufToBase64url(response.userHandle) : null,
            },
          },
          userId: startData.userId,
        }),
      });
      const finishData = await finishRes.json();
      if (finishData.error) { error = finishData.error; loading = false; step = 'idle'; pendingPassword = ''; return; }

      const setPasswordRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set-password', password: pendingPassword }),
      });
      const setPasswordData = await setPasswordRes.json();
      pendingPassword = '';

      if (setPasswordData.error) {
        error = 'Signed in but failed to set password. You can set it from your profile.';
        loading = false;
        step = 'idle';
        return;
      }

      goto('/');
    } catch (e: any) {
      error = e?.name === 'NotAllowedError' ? 'Sign-in was cancelled' : e?.message || 'Failed';
      loading = false;
      step = 'idle';
      pendingPassword = '';
    }
  }

  function submit(e: Event) {
    e.preventDefault();
    if (!username.trim()) return;
    if (mode === 'register') {
      if (authMethod === 'passkey') handleRegister();
      else handleRegisterPassword();
    } else {
      if (authMethod === 'passkey') handleLogin();
      else handleLoginPassword();
    }
  }
</script>

<svelte:head><title>{mode === 'register' ? 'Create Account' : 'Sign In'} - Food Tracker</title></svelte:head>

<main>
  <div class="login-card" class:register-mode={mode === 'register'}>
    <div class="logo">{mode === 'register' ? '✨' : '🍽️'}</div>
    <h1>Food Tracker</h1>
    {#if mode === 'register'}
      <p class="subtitle">Create your account</p>
    {:else}
      <p class="subtitle">Sign in to your account</p>
    {/if}

    {#if error}
      <div class="error">{error}</div>
    {/if}

    {#if confirmMessage}
      <div class="confirm-msg">{confirmMessage}</div>
    {/if}

    {#if step === 'working'}
      <div class="step-msg">
        <div class="spinner"></div>
        <p>{mode === 'register' ? 'Creating your account...' : 'Waiting for device...'}</p>
        <p class="step-hint">Use Touch ID, Face ID, or your security key</p>
        <button class="cancel" onclick={() => { loading = false; step = 'idle'; error = ''; confirmMessage = ''; pendingPassword = ''; }}>Cancel</button>
      </div>
    {:else}
      <form onsubmit={submit}>
        <input
          bind:value={username}
          placeholder="Username"
          autocomplete="username"
          class="input"
          disabled={loading}
        />

        {#if authMethod === 'passkey'}
          <button type="submit" class="submit passkey-btn" disabled={loading || !username.trim()}>
            {mode === 'register' ? 'Create with Face ID / Touch ID' : 'Sign in with Face ID / Touch ID'}
          </button>

          <div class="divider">or</div>

          <button type="button" class="link-btn" onclick={() => { authMethod = 'password'; error = ''; confirmMessage = ''; }}>
            Click here to use a password instead
          </button>
        {:else}
          <input
            bind:value={password}
            type="password"
            placeholder="Password"
            autocomplete={mode === 'register' ? 'new-password' : 'current-password'}
            class="input"
            disabled={loading}
          />
          {#if mode === 'register'}
            <input
              bind:value={confirmPassword}
              type="password"
              placeholder="Confirm password"
              autocomplete="new-password"
              class="input"
              disabled={loading}
            />
          {/if}

          <button type="submit" class="submit" disabled={loading || !username.trim() || !password.trim()}>
            {mode === 'register' ? 'Create Account' : 'Sign In'}
          </button>

          <div class="divider">or</div>

          <button type="button" class="link-btn" onclick={() => { authMethod = 'passkey'; error = ''; confirmMessage = ''; password = ''; confirmPassword = ''; }}>
            {mode === 'register' ? 'Click here to use Face ID / Touch ID instead' : 'Click here to use Face ID / Touch ID instead'}
          </button>
        {/if}
      </form>

      <button class="toggle" onclick={() => { mode = mode === 'login' ? 'register' : 'login'; error = ''; confirmMessage = ''; password = ''; confirmPassword = ''; }}>
        {mode === 'login' ? "Don't have an account? Register" : 'Already have an account? Sign in'}
      </button>
    {/if}
  </div>
</main>

<style>
  main { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 16px; background: #f5f5f5; }
  .login-card { background: #fff; border-radius: 16px; padding: 32px 24px; width: 100%; max-width: 340px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); text-align: center; }
  .logo { font-size: 48px; margin-bottom: 8px; }
  h1 { margin: 0 0 4px; font-size: 22px; }
  .subtitle { margin: 0 0 20px; color: #888; font-size: 14px; }
  .error { background: #fff5f5; border: 1px solid #ffcdd2; color: #c00; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
  .confirm-msg { background: #e8f5e9; border: 1px solid #c8e6c9; color: #2e7d32; padding: 8px 12px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
  .input { width: 100%; padding: 12px; border: 1px solid #ddd; border-radius: 10px; font-size: 16px; margin-bottom: 12px; box-sizing: border-box; text-align: center; font-family: inherit; }
  .input:focus { outline: none; border-color: #4CAF50; }
  .register-mode .input:focus { border-color: #5B6CF7; }
  .submit { width: 100%; padding: 12px; background: #4CAF50; color: #fff; border: none; border-radius: 10px; font-size: 16px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .register-mode .submit { background: #5B6CF7; }
  .passkey-btn { background: #333; }
  .passkey-btn:hover { background: #555; }
  .register-mode .passkey-btn { background: #5B6CF7; }
  .register-mode .passkey-btn:hover { background: #4A5AE0; }
  .submit:disabled { opacity: 0.5; cursor: not-allowed; }
  .submit:hover:not(:disabled) { background: #388E3C; }
  .register-mode .submit:hover:not(:disabled) { background: #4A5AE0; }
  .divider { margin: 16px 0; font-size: 13px; color: #bbb; position: relative; }
  .divider::before, .divider::after { content: ''; position: absolute; top: 50%; width: 40%; height: 1px; background: #eee; }
  .divider::before { left: 0; }
  .divider::after { right: 0; }
  .link-btn { background: none; border: 1px solid transparent; color: #4CAF50; font-size: 15px; font-weight: 500; cursor: pointer; padding: 12px 16px; border-radius: 10px; font-family: inherit; width: 100%; box-sizing: border-box; }
  .register-mode .link-btn { color: #5B6CF7; }
  .link-btn:hover { background: #f5f5f5; text-decoration: underline; }
  .toggle { background: none; border: none; color: #4CAF50; font-size: 13px; cursor: pointer; margin-top: 16px; padding: 0; font-family: inherit; }
  .register-mode .toggle { color: #5B6CF7; }
  .toggle:hover { text-decoration: underline; }
  .step-msg { padding: 20px 0; }
  .step-msg p { margin: 8px 0 0; font-size: 15px; }
  .step-hint { color: #888; font-size: 13px !important; }
  .cancel { margin-top: 12px; background: none; border: 1px solid #ddd; color: #888; padding: 6px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; font-family: inherit; }
  .spinner { width: 32px; height: 32px; border: 3px solid #eee; border-top-color: #4CAF50; border-radius: 50%; animation: spin 0.8s linear infinite; margin: 0 auto; }
  .register-mode .spinner { border-top-color: #5B6CF7; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
