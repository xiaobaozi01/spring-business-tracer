package com.acme.inventory.service;

import com.acme.inventory.mapper.InventoryMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class InventoryService {
    private final InventoryMapper inventoryMapper;

    public InventoryService(InventoryMapper inventoryMapper) {
        this.inventoryMapper = inventoryMapper;
    }

    @Transactional
    public void reserve(String sku, int quantity) {
        int available = inventoryMapper.findAvailable(sku);
        if (available < quantity) {
            throw new IllegalStateException("库存不足");
        }
        inventoryMapper.decreaseStock(sku, quantity);
        inventoryMapper.insertReservation(sku, quantity);
    }

    @Transactional
    public void releaseExpired() {
        List<String> skus = inventoryMapper.findExpiredReservations();
        for (String sku : skus) {
            inventoryMapper.restoreStock(sku);
            inventoryMapper.deleteReservation(sku);
        }
    }
}
