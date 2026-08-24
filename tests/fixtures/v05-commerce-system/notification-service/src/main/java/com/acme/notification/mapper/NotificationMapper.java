package com.acme.notification.mapper;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface NotificationMapper {
    void insertDelivery(@Param("bizNo") String bizNo);
}
