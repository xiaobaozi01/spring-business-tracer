package com.acme.order.event;

import com.acme.order.mapper.AuditMapper;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

@Component
public class OrderAuditListener {
    private final AuditMapper auditMapper;

    public OrderAuditListener(AuditMapper auditMapper) {
        this.auditMapper = auditMapper;
    }

    @EventListener
    public void onCreated(OrderCreatedEvent event) {
        auditMapper.insertAudit(event.getBizNo());
    }
}
