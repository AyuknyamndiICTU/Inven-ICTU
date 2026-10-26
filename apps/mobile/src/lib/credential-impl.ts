// Metro resolves `credential-impl.android.ts` on Android; everything else (web) uses the passkey provider.
export { webCredential as credentialProvider } from './credential.web';
