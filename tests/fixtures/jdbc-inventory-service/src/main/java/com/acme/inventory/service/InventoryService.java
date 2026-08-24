package com.acme.inventory.service;

import com.acme.inventory.repository.InventoryRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryService {
    private final InventoryRepository inventoryRepository;

    public InventoryService(InventoryRepository inventoryRepository) {
        this.inventoryRepository = inventoryRepository;
    }

    @Transactional
    public int reserve(String sku, int quantity) {
        int available = inventoryRepository.findAvailable(sku);
        if (available < quantity) {
            throw new IllegalStateException("库存不足");
        }
        inventoryRepository.decreaseAvailable(sku, quantity);
        return inventoryRepository.findAvailable(sku);
    }
}
