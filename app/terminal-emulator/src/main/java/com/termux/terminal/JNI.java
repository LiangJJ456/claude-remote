package com.termux.terminal;

/**
 * Stubbed for Claude Remote: this app drives the emulator from a remote WebSocket byte stream,
 * never from a local PTY subprocess, so no native library is loaded. These methods are only
 * reachable from TerminalSession's local-process path, which remote mode skips.
 */
final class JNI {

    public static int createSubprocess(String cmd, String cwd, String[] args, String[] envVars, int[] processId, int rows, int columns, int cellWidth, int cellHeight) {
        throw new UnsupportedOperationException("Local PTY subprocess not supported in remote mode");
    }

    public static void setPtyWindowSize(int fd, int rows, int cols, int cellWidth, int cellHeight) {
        // no-op: no local pty in remote mode
    }

    public static int waitFor(int processId) {
        throw new UnsupportedOperationException("Local PTY subprocess not supported in remote mode");
    }

    public static void close(int fileDescriptor) {
        // no-op: no local pty fd in remote mode
    }

}
