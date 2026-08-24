package com.acme.order.event;

public class OrderCreatedEvent {
    private final String bizNo;

    public OrderCreatedEvent(String bizNo) {
        this.bizNo = bizNo;
    }

    public String getBizNo() { return bizNo; }
}
