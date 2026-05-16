from __future__ import annotations

import argparse
import json
import random
from dataclasses import dataclass
from pathlib import Path

import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from PIL import Image, ImageOps
from torch.utils.data import DataLoader, Dataset


class DoubleConv(nn.Module):
    def __init__(self, in_channels: int, out_channels: int) -> None:
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_channels, out_channels, kernel_size=3, padding=1),
            nn.BatchNorm2d(out_channels),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class SmallWaterUNet(nn.Module):
    def __init__(self, base_channels: int = 24) -> None:
        super().__init__()
        self.down1 = DoubleConv(3, base_channels)
        self.down2 = DoubleConv(base_channels, base_channels * 2)
        self.down3 = DoubleConv(base_channels * 2, base_channels * 4)
        self.down4 = DoubleConv(base_channels * 4, base_channels * 8)
        self.pool = nn.MaxPool2d(2)

        self.up3 = nn.ConvTranspose2d(base_channels * 8, base_channels * 4, kernel_size=2, stride=2)
        self.conv3 = DoubleConv(base_channels * 8, base_channels * 4)
        self.up2 = nn.ConvTranspose2d(base_channels * 4, base_channels * 2, kernel_size=2, stride=2)
        self.conv2 = DoubleConv(base_channels * 4, base_channels * 2)
        self.up1 = nn.ConvTranspose2d(base_channels * 2, base_channels, kernel_size=2, stride=2)
        self.conv1 = DoubleConv(base_channels * 2, base_channels)
        self.out = nn.Conv2d(base_channels, 1, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x1 = self.down1(x)
        x2 = self.down2(self.pool(x1))
        x3 = self.down3(self.pool(x2))
        x4 = self.down4(self.pool(x3))

        y = self.up3(x4)
        y = self.conv3(torch.cat([y, x3], dim=1))
        y = self.up2(y)
        y = self.conv2(torch.cat([y, x2], dim=1))
        y = self.up1(y)
        y = self.conv1(torch.cat([y, x1], dim=1))
        return self.out(y)


@dataclass
class ManifestItem:
    image: str
    mask: str
    split: str


class WaterDataset(Dataset):
    def __init__(self, root: Path, split: str, image_size: int, max_items: int | None = None) -> None:
        manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
        items = [ManifestItem(image=item["image"], mask=item["mask"], split=item["split"]) for item in manifest if item["split"] == split]
        if max_items is not None:
            items = items[:max_items]
        self.root = root
        self.items = items
        self.image_size = image_size

    def __len__(self) -> int:
        return len(self.items)

    def __getitem__(self, index: int) -> tuple[torch.Tensor, torch.Tensor]:
        item = self.items[index]
        with Image.open(self.root / item.image) as raw_image:
            image = raw_image.convert("RGB").resize((self.image_size, self.image_size), Image.BILINEAR)
        with Image.open(self.root / item.mask) as raw_mask:
            mask = ImageOps.grayscale(raw_mask).resize((self.image_size, self.image_size), Image.NEAREST)

        image_tensor = torch.from_numpy(np.array(image, dtype=np.float32)).view(self.image_size, self.image_size, 3)
        image_tensor = image_tensor.permute(2, 0, 1) / 255.0
        mask_tensor = torch.from_numpy(np.array(mask, dtype=np.float32)).view(1, self.image_size, self.image_size)
        mask_tensor = (mask_tensor >= 128).float()
        return image_tensor, mask_tensor


def dice_loss(logits: torch.Tensor, targets: torch.Tensor) -> torch.Tensor:
    probs = torch.sigmoid(logits)
    intersection = (probs * targets).sum(dim=(1, 2, 3))
    union = probs.sum(dim=(1, 2, 3)) + targets.sum(dim=(1, 2, 3))
    return 1.0 - ((2.0 * intersection + 1.0) / (union + 1.0)).mean()


def batch_iou(logits: torch.Tensor, targets: torch.Tensor) -> float:
    preds = (torch.sigmoid(logits) >= 0.5).float()
    intersection = (preds * targets).sum(dim=(1, 2, 3))
    union = ((preds + targets) > 0).float().sum(dim=(1, 2, 3))
    iou = (intersection + 1.0) / (union + 1.0)
    return float(iou.mean().item())


def train_one_epoch(model: nn.Module, loader: DataLoader, optimizer: torch.optim.Optimizer, device: torch.device) -> tuple[float, float]:
    model.train()
    total_loss = 0.0
    total_iou = 0.0
    for images, masks in loader:
        images = images.to(device)
        masks = masks.to(device)
        optimizer.zero_grad(set_to_none=True)
        logits = model(images)
        loss = F.binary_cross_entropy_with_logits(logits, masks) + dice_loss(logits, masks)
        loss.backward()
        optimizer.step()
        total_loss += float(loss.item())
        total_iou += batch_iou(logits.detach(), masks)
    return total_loss / max(1, len(loader)), total_iou / max(1, len(loader))


@torch.no_grad()
def validate(model: nn.Module, loader: DataLoader, device: torch.device) -> tuple[float, float]:
    model.eval()
    total_loss = 0.0
    total_iou = 0.0
    for images, masks in loader:
        images = images.to(device)
        masks = masks.to(device)
        logits = model(images)
        loss = F.binary_cross_entropy_with_logits(logits, masks) + dice_loss(logits, masks)
        total_loss += float(loss.item())
        total_iou += batch_iou(logits, masks)
    return total_loss / max(1, len(loader)), total_iou / max(1, len(loader))


def main() -> None:
    parser = argparse.ArgumentParser(description="Train a lightweight local water segmentation model.")
    parser.add_argument("--dataset", required=True, type=Path, help="Prepared dataset directory with manifest.json.")
    parser.add_argument("--out", required=True, type=Path, help="Output checkpoint path.")
    parser.add_argument("--epochs", type=int, default=8)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--image-size", type=int, default=512)
    parser.add_argument("--base-channels", type=int, default=24)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--max-train-items", type=int, default=None)
    parser.add_argument("--max-val-items", type=int, default=None)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    train_dataset = WaterDataset(args.dataset, "train", args.image_size, max_items=args.max_train_items)
    val_dataset = WaterDataset(args.dataset, "val", args.image_size, max_items=args.max_val_items)
    if len(train_dataset) == 0 or len(val_dataset) == 0:
        raise RuntimeError("Dataset must contain train and val items.")

    train_loader = DataLoader(train_dataset, batch_size=args.batch_size, shuffle=True, num_workers=args.workers, pin_memory=device.type == "cuda")
    val_loader = DataLoader(val_dataset, batch_size=args.batch_size, shuffle=False, num_workers=args.workers, pin_memory=device.type == "cuda")

    model = SmallWaterUNet(base_channels=args.base_channels).to(device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)

    best_iou = -1.0
    args.out.parent.mkdir(parents=True, exist_ok=True)
    for epoch in range(args.epochs):
        train_loss, train_iou = train_one_epoch(model, train_loader, optimizer, device)
        val_loss, val_iou = validate(model, val_loader, device)
        print(
            f"epoch={epoch + 1}/{args.epochs} "
            f"train_loss={train_loss:.4f} train_iou={train_iou:.4f} "
            f"val_loss={val_loss:.4f} val_iou={val_iou:.4f}",
            flush=True,
        )
        if val_iou > best_iou:
            best_iou = val_iou
            torch.save(
                {
                    "model": model.state_dict(),
                    "image_size": args.image_size,
                    "base_channels": args.base_channels,
                    "best_iou": best_iou,
                    "backend": "water-unet",
                },
                args.out,
            )
            print(f"saved {args.out} best_iou={best_iou:.4f}", flush=True)


if __name__ == "__main__":
    main()
