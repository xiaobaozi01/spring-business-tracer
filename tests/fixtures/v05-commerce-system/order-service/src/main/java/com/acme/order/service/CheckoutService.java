package com.acme.order.service;

import com.acme.order.client.CustomerClient;
import com.acme.order.client.InventoryClient;
import com.acme.order.client.dto.ReserveStockRequest;
import com.acme.order.event.OrderEventPublisher;
import com.acme.order.mapper.OrderMapper;
import com.acme.order.messaging.OrderMessagePublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CheckoutService {
    private final CustomerClient customerClient;
    private final InventoryClient inventoryClient;
    private final OrderMapper orderMapper;
    private final OrderMessagePublisher messagePublisher;
    private final OrderEventPublisher eventPublisher;

    public CheckoutService(CustomerClient customerClient, InventoryClient inventoryClient, OrderMapper orderMapper,
                           OrderMessagePublisher messagePublisher, OrderEventPublisher eventPublisher) {
        this.customerClient = customerClient;
        this.inventoryClient = inventoryClient;
        this.orderMapper = orderMapper;
        this.messagePublisher = messagePublisher;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public Long create(String bizNo, Long customerId, String sku, int quantity) {
        customerClient.requireActive(customerId);
        inventoryClient.reserve(new ReserveStockRequest(sku, quantity));
        orderMapper.insertOrder(bizNo, customerId);
        messagePublisher.publish(bizNo);
        eventPublisher.publish(bizNo);
        return Math.abs((long) bizNo.hashCode());
    }
}
