import os

from isegm.utils.exp_imports.default import *

MODEL_NAME = 'gis_tiles_hrnet18'


def main(cfg):
    model, model_cfg = init_model(cfg)
    train(model, cfg, model_cfg)


def init_model(cfg):
    model_cfg = edict()
    model_cfg.crop_size = tuple(cfg.GIS_CROP_SIZE)
    model_cfg.num_max_points = int(cfg.GIS_MAX_POINTS)

    model = HRNetModel(
        width=18,
        ocr_width=64,
        with_aux_output=True,
        use_leaky_relu=True,
        use_rgb_conv=False,
        use_disks=True,
        norm_radius=5,
        with_prev_mask=True,
    )

    model.to(cfg.device)
    model.apply(initializer.XavierGluon(rnd_type='gaussian', magnitude=2.0))

    return model, model_cfg


def train(model, cfg, model_cfg):
    cfg.batch_size = 4 if cfg.batch_size < 1 else cfg.batch_size
    cfg.val_batch_size = cfg.batch_size
    crop_size = model_cfg.crop_size

    loss_cfg = edict()
    loss_cfg.instance_loss = NormalizedFocalLossSigmoid(alpha=0.5, gamma=2)
    loss_cfg.instance_loss_weight = 1.0
    loss_cfg.instance_aux_loss = SigmoidBinaryCrossEntropyLoss()
    loss_cfg.instance_aux_loss_weight = 0.4

    train_augmentator = Compose([
        UniformRandomResize(scale_range=(0.80, 1.25)),
        HorizontalFlip(),
        VerticalFlip(),
        RandomRotate90(),
        PadIfNeeded(min_height=crop_size[0], min_width=crop_size[1], border_mode=0),
        RandomCrop(*crop_size),
        RandomBrightnessContrast(brightness_limit=(-0.20, 0.20), contrast_limit=(-0.15, 0.25), p=0.60),
        RGBShift(r_shift_limit=8, g_shift_limit=8, b_shift_limit=8, p=0.45),
    ], p=1.0)

    val_augmentator = Compose([
        PadIfNeeded(min_height=crop_size[0], min_width=crop_size[1], border_mode=0),
        RandomCrop(*crop_size),
    ], p=1.0)

    points_sampler = MultiPointSampler(
        model_cfg.num_max_points,
        prob_gamma=0.80,
        merge_objects_prob=0.05,
        max_num_merged_objects=2,
    )

    train_epoch_len = int(os.getenv('GIS_TRAIN_EPOCH_LEN', cfg.GIS_TRAIN_EPOCH_LEN))
    val_epoch_len = int(os.getenv('GIS_VAL_EPOCH_LEN', cfg.GIS_VAL_EPOCH_LEN))
    num_epochs = int(os.getenv('GIS_NUM_EPOCHS', cfg.GIS_NUM_EPOCHS))
    min_object_area = int(os.getenv('GIS_MIN_OBJECT_AREA', cfg.GIS_MIN_OBJECT_AREA))
    min_component_area = int(os.getenv('GIS_MIN_COMPONENT_AREA', cfg.GIS_MIN_COMPONENT_AREA))

    trainset = GisTilesDataset(
        cfg.GIS_TILES_PATH,
        split='train',
        augmentator=train_augmentator,
        min_object_area=min_object_area,
        keep_background_prob=0.02,
        points_sampler=points_sampler,
        epoch_len=train_epoch_len,
        min_component_area=min_component_area,
    )

    valset = GisTilesDataset(
        cfg.GIS_TILES_PATH,
        split='val',
        augmentator=val_augmentator,
        min_object_area=min_object_area,
        points_sampler=points_sampler,
        epoch_len=val_epoch_len,
        min_component_area=min_component_area,
    )

    optimizer_params = {
        'lr': 1e-5,
        'betas': (0.9, 0.999),
        'eps': 1e-8,
    }

    first_milestone = max(1, int(num_epochs * 0.65))
    second_milestone = max(first_milestone + 1, int(num_epochs * 0.85))
    lr_scheduler = partial(
        torch.optim.lr_scheduler.MultiStepLR,
        milestones=[first_milestone, second_milestone],
        gamma=0.2,
    )

    trainer = ISTrainer(
        model,
        cfg,
        model_cfg,
        loss_cfg,
        trainset,
        valset,
        optimizer='adam',
        optimizer_params=optimizer_params,
        lr_scheduler=lr_scheduler,
        checkpoint_interval=1,
        image_dump_interval=250,
        metrics=[AdaptiveIoU()],
        max_interactive_points=model_cfg.num_max_points,
        max_num_next_clicks=3,
    )
    trainer.run(num_epochs=num_epochs)
