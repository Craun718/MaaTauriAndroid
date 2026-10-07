export async function releaseStartupSplashAfterBootstrap(
  release: () => Promise<void>,
  reportError: (error: unknown) => void,
): Promise<boolean> {
  try {
    await release();
    return true;
  } catch (error) {
    reportError(error);
    return false;
  }
}
