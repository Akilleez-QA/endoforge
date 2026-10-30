# Portable checkpoints

Use checkpoint.py to encrypt a staged checkpoint with age and validate its inventory on restore. Supply your own toolchain bundle and pins to resume_stage.py for offline verification. campaign_transfer.py requires an explicit host and an owned temporary staging directory. Keep keys and generated evidence outside this source tree.
