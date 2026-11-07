#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/sched.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>

#define MARK "/__ef_mark__/"
#define GET_SYSCALL_INFO 0x420e
#define INFO_ENTRY 1
struct syscall_info {
  uint8_t op;
  uint8_t pad[3];
  uint32_t arch;
  uint64_t ip, sp;
  struct { uint64_t nr, args[6]; } entry;
  uint64_t reserved[8];
};
static FILE *out;

static void read_path(pid_t pid, uint64_t address, char *buffer, size_t size) {
  struct iovec local = {buffer, size - 1}, remote = {(void *)address, size - 1};
  ssize_t count = process_vm_readv(pid, &local, 1, &remote, 1, 0);
  if (count < 0) {
    size_t page = 4096 - (address % 4096);
    remote.iov_len = local.iov_len = page < size - 1 ? page : size - 1;
    count = process_vm_readv(pid, &local, 1, &remote, 1, 0);
  }
  buffer[count > 0 ? count : 0] = 0;
  buffer[strnlen(buffer, size - 1)] = 0;
}

static void event(const char *kind, pid_t pid, const char *name, const char *path) {
  fprintf(out, "{\"kind\":\"%s\",\"pid\":%d,\"sys\":\"%s\",\"path\":\"", kind, pid, name);
  for (const char *c = path; c && *c; c++) {
    if (*c == '"' || *c == '\\') fputc('\\', out);
    if ((unsigned char)*c >= 32 && (unsigned char)*c < 127) fputc(*c, out);
  }
  fputs("\"}\n", out);
}

static void mark_or_nothing(pid_t pid, uint64_t address) {
  char path[4096];
  read_path(pid, address, path, sizeof path);
  if (!strncmp(path, MARK, strlen(MARK))) {
    event("mark", pid, "stat", path + strlen(MARK));
    fflush(out);
  }
}

static void file_change(pid_t pid, const char *name, uint64_t address) {
  char path[4096];
  read_path(pid, address, path, sizeof path);
  event("write", pid, name, path);
}

static void open_event(pid_t pid, const char *name, uint64_t address, uint64_t flags) {
  char path[4096];
  read_path(pid, address, path, sizeof path);
  int writes = (flags & O_ACCMODE) != O_RDONLY || (flags & (O_CREAT | O_TRUNC | O_APPEND | __O_TMPFILE));
  event(writes ? "write" : "read", pid, name, path);
}

static void fd_change(pid_t pid, const char *name, uint64_t fd) {
  char link[64], path[4096];
  snprintf(link, sizeof link, "/proc/%d/fd/%d", pid, (int)fd);
  ssize_t count = readlink(link, path, sizeof path - 1);
  if (count <= 0) return;
  path[count] = 0;
  if (path[0] != '/' || (!strncmp(path, "/dev/", 5) && strncmp(path, "/dev/shm/", 9))) return;
  event("write", pid, name, path);
}

static void on_entry(pid_t pid, struct syscall_info *info) {
  uint64_t nr = info->entry.nr, *a = info->entry.args;
  switch (nr) {
    case SYS_execve: { char path[4096]; read_path(pid, a[0], path, sizeof path); event("spawn", pid, "execve", path); break; }
    case SYS_execveat: fprintf(out, "{\"kind\":\"spawn\",\"pid\":%d,\"sys\":\"execveat\"}\n", pid); break;
#ifdef SYS_fork
    case SYS_fork: fprintf(out, "{\"kind\":\"spawn\",\"pid\":%d,\"sys\":\"fork\"}\n", pid); break;
#endif
#ifdef SYS_vfork
    case SYS_vfork: fprintf(out, "{\"kind\":\"spawn\",\"pid\":%d,\"sys\":\"vfork\"}\n", pid); break;
#endif
    case SYS_clone:
      if (!(a[0] & CLONE_THREAD)) fprintf(out, "{\"kind\":\"spawn\",\"pid\":%d,\"sys\":\"clone\"}\n", pid);
      break;
    case SYS_clone3: {
      uint64_t flags = 0;
      struct iovec local = {&flags, sizeof flags}, remote = {(void *)a[0], sizeof flags};
      if (process_vm_readv(pid, &local, 1, &remote, 1, 0) != sizeof flags || !(flags & CLONE_THREAD))
        fprintf(out, "{\"kind\":\"spawn\",\"pid\":%d,\"sys\":\"clone3\"}\n", pid);
      break;
    }
#ifdef SYS_open
    case SYS_open: open_event(pid, "open", a[0], a[1]); break;
#endif
    case SYS_openat: open_event(pid, "openat", a[1], a[2]); break;
#ifdef SYS_openat2
    case SYS_openat2: {
      uint64_t flags = 0;
      struct iovec local = {&flags, sizeof flags}, remote = {(void *)a[2], sizeof flags};
      process_vm_readv(pid, &local, 1, &remote, 1, 0);
      open_event(pid, "openat2", a[1], flags);
      break;
    }
#endif
#ifdef SYS_creat
    case SYS_creat: file_change(pid, "creat", a[0]); break;
#endif
#ifdef SYS_mkdir
    case SYS_mkdir: file_change(pid, "mkdir", a[0]); break;
#endif
    case SYS_mkdirat: file_change(pid, "mkdirat", a[1]); break;
#ifdef SYS_rename
    case SYS_rename: file_change(pid, "rename", a[0]); break;
#endif
    case SYS_renameat: file_change(pid, "renameat", a[1]); break;
    case SYS_renameat2: file_change(pid, "renameat2", a[1]); break;
#ifdef SYS_unlink
    case SYS_unlink: file_change(pid, "unlink", a[0]); break;
#endif
    case SYS_unlinkat: file_change(pid, "unlinkat", a[1]); break;
#ifdef SYS_rmdir
    case SYS_rmdir: file_change(pid, "rmdir", a[0]); break;
#endif
#ifdef SYS_link
    case SYS_link: file_change(pid, "link", a[0]); break;
#endif
    case SYS_linkat: file_change(pid, "linkat", a[1]); break;
#ifdef SYS_symlink
    case SYS_symlink: file_change(pid, "symlink", a[1]); break;
#endif
    case SYS_symlinkat: file_change(pid, "symlinkat", a[2]); break;
    case SYS_truncate: file_change(pid, "truncate", a[0]); break;
    case SYS_write: fd_change(pid, "write", a[0]); break;
    case SYS_writev: fd_change(pid, "writev", a[0]); break;
    case SYS_pwrite64: fd_change(pid, "pwrite64", a[0]); break;
    case SYS_pwritev: fd_change(pid, "pwritev", a[0]); break;
    case SYS_ftruncate: fd_change(pid, "ftruncate", a[0]); break;
    case SYS_fallocate: fd_change(pid, "fallocate", a[0]); break;
    case SYS_memfd_create: file_change(pid, "memfd_create", a[0]); break;
#ifdef SYS_stat
    case SYS_stat: mark_or_nothing(pid, a[0]); break;
#endif
#ifdef SYS_lstat
    case SYS_lstat: mark_or_nothing(pid, a[0]); break;
#endif
#ifdef SYS_newfstatat
    case SYS_newfstatat: mark_or_nothing(pid, a[1]); break;
#endif
    case SYS_statx: mark_or_nothing(pid, a[1]); break;
    default: break;
  }
}

int main(int argc, char **argv) {
  if (argc < 3) return 2;
  out = fopen(argv[1], "w");
  if (!out) return 2;
  pid_t root = fork();
  if (!root) {
    ptrace(PTRACE_TRACEME, 0, 0, 0);
    raise(SIGSTOP);
    execvp(argv[2], argv + 2);
    _exit(127);
  }
  int status, code = 1;
  waitpid(root, &status, 0);
  long options = PTRACE_O_TRACESYSGOOD | PTRACE_O_TRACECLONE | PTRACE_O_TRACEFORK | PTRACE_O_TRACEVFORK | PTRACE_O_TRACEEXEC | PTRACE_O_EXITKILL;
  if (ptrace(PTRACE_SETOPTIONS, root, 0, options)) return 2;
  ptrace(PTRACE_SYSCALL, root, 0, 0);
  for (;;) {
    pid_t pid = waitpid(-1, &status, __WALL);
    if (pid < 0) break;
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      if (pid == root) code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
      continue;
    }
    int signal_number = 0;
    if (WIFSTOPPED(status)) {
      int stop = WSTOPSIG(status);
      if (stop == (SIGTRAP | 0x80)) {
        struct syscall_info info;
        if (ptrace(GET_SYSCALL_INFO, pid, sizeof info, &info) > 0 && info.op == INFO_ENTRY) on_entry(pid, &info);
      } else if (status >> 16) {
        unsigned long child = 0;
        int kind = status >> 16;
        if ((kind == PTRACE_EVENT_CLONE || kind == PTRACE_EVENT_FORK || kind == PTRACE_EVENT_VFORK) && !ptrace(PTRACE_GETEVENTMSG, pid, 0, &child))
          fprintf(out, "{\"kind\":\"child\",\"pid\":%d,\"child\":%lu}\n", pid, child);
        signal_number = 0;
      } else if (stop == SIGSTOP) {
        signal_number = 0;
      } else if (stop != SIGTRAP) {
        signal_number = stop;
      }
    }
    ptrace(PTRACE_SYSCALL, pid, 0, signal_number);
  }
  fclose(out);
  return code;
}
