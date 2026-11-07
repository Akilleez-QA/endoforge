#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdatomic.h>
#include <unistd.h>
static atomic_long syncs;
long sync_count(void) { return atomic_load(&syncs); }
int fsync(int fd) { static int (*real)(int); if (!real) real = dlsym(RTLD_NEXT, "fsync"); atomic_fetch_add(&syncs, 1); return real(fd); }
int fdatasync(int fd) { static int (*real)(int); if (!real) real = dlsym(RTLD_NEXT, "fdatasync"); atomic_fetch_add(&syncs, 1); return real(fd); }
